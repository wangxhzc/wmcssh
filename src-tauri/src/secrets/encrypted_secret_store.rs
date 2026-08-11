use crate::contracts::{AppErrorCode, AppErrorDto};
use crate::secrets::secret_store::SecretStore;
use crate::utils::time::now_millis;
use argon2::{Algorithm, Argon2, Params, Version};
use async_trait::async_trait;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::{rngs::OsRng, RngCore};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use zeroize::Zeroizing;

const VAULT_CHECK: &[u8] = b"wmcssh-credential-vault-v1";
const MEMORY_COST_KIB: u32 = 65_536;
const ITERATIONS: u32 = 3;
const PARALLELISM: u32 = 1;

pub struct EncryptedSecretStore {
    db: SqlitePool,
    key: Mutex<Option<Zeroizing<Vec<u8>>>>,
    legacy_path: PathBuf,
}

impl EncryptedSecretStore {
    pub fn new(db: SqlitePool, legacy_path: PathBuf) -> Self {
        Self {
            db,
            key: Mutex::new(None),
            legacy_path,
        }
    }

    pub async fn is_initialized(&self) -> Result<bool, AppErrorDto> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM credential_vault WHERE id = 1")
            .fetch_one(&self.db)
            .await
            .map_err(AppErrorDto::database)?;
        Ok(count > 0)
    }

    pub fn is_unlocked(&self) -> bool {
        self.key.lock().unwrap_or_else(|p| p.into_inner()).is_some()
    }

    pub fn has_legacy_credentials(&self) -> bool {
        self.legacy_path.exists()
    }

    pub async fn initialize_and_migrate(&self, password: &str) -> Result<(), AppErrorDto> {
        let legacy_values = if self.has_legacy_credentials() {
            let content = std::fs::read_to_string(&self.legacy_path).map_err(AppErrorDto::io)?;
            Some(
                serde_json::from_str::<HashMap<String, String>>(&content).map_err(|error| {
                    AppErrorDto::with_details(
                        AppErrorCode::SecretStoreError,
                        "旧凭据文件无法解析",
                        error.to_string(),
                        false,
                    )
                })?,
            )
        } else {
            None
        };

        self.initialize(password).await?;
        let migration_result = async {
            if let Some(values) = legacy_values {
                for (key, value) in values {
                    self.set_secret(&key, &value).await?;
                }
                std::fs::remove_file(&self.legacy_path).map_err(AppErrorDto::io)?;
            }
            Ok::<(), AppErrorDto>(())
        }
        .await;

        if let Err(error) = migration_result {
            self.lock();
            let _ = sqlx::query("DELETE FROM encrypted_secrets")
                .execute(&self.db)
                .await;
            let _ = sqlx::query("DELETE FROM credential_vault WHERE id = 1")
                .execute(&self.db)
                .await;
            return Err(error);
        }
        Ok(())
    }

    pub async fn initialize(&self, password: &str) -> Result<(), AppErrorDto> {
        if password.is_empty() {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "主密码不能为空",
                false,
            ));
        }
        if self.is_initialized().await? {
            return Err(AppErrorDto::new(
                AppErrorCode::Unsupported,
                "凭据库已经初始化",
                false,
            ));
        }
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let key = derive_key(password, &salt, MEMORY_COST_KIB, ITERATIONS, PARALLELISM)?;
        let (nonce, ciphertext) = encrypt(&key, "vault-check", VAULT_CHECK)?;
        let now = now_millis();
        sqlx::query("INSERT INTO credential_vault (id, version, salt, memory_cost_kib, iterations, parallelism, verification_nonce, verification_ciphertext, created_at, updated_at) VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(salt.to_vec()).bind(MEMORY_COST_KIB as i64).bind(ITERATIONS as i64)
            .bind(PARALLELISM as i64).bind(nonce).bind(ciphertext).bind(now).bind(now)
            .execute(&self.db).await.map_err(AppErrorDto::database)?;
        *self.key.lock().unwrap_or_else(|p| p.into_inner()) = Some(Zeroizing::new(key));
        Ok(())
    }

    pub async fn unlock(&self, password: &str) -> Result<(), AppErrorDto> {
        let row = sqlx::query("SELECT salt, memory_cost_kib, iterations, parallelism, verification_nonce, verification_ciphertext FROM credential_vault WHERE id = 1")
            .fetch_optional(&self.db).await.map_err(AppErrorDto::database)?
            .ok_or_else(|| AppErrorDto::new(AppErrorCode::SecretStoreError, "凭据库尚未初始化", false))?;
        let salt: Vec<u8> = row.get("salt");
        let key = derive_key(
            password,
            &salt,
            row.get::<i64, _>("memory_cost_kib") as u32,
            row.get::<i64, _>("iterations") as u32,
            row.get::<i64, _>("parallelism") as u32,
        )?;
        let nonce: Vec<u8> = row.get("verification_nonce");
        let ciphertext: Vec<u8> = row.get("verification_ciphertext");
        let check = decrypt(&key, "vault-check", &nonce, &ciphertext)
            .map_err(|_| AppErrorDto::new(AppErrorCode::AuthFailed, "主密码错误", false))?;
        if check != VAULT_CHECK {
            return Err(AppErrorDto::new(
                AppErrorCode::AuthFailed,
                "主密码错误",
                false,
            ));
        }
        *self.key.lock().unwrap_or_else(|p| p.into_inner()) = Some(Zeroizing::new(key));
        Ok(())
    }

    pub fn lock(&self) {
        *self.key.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    fn unlocked_key(&self) -> Result<Zeroizing<Vec<u8>>, AppErrorDto> {
        self.key
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .cloned()
            .ok_or_else(|| AppErrorDto::new(AppErrorCode::SecretStoreError, "凭据库已锁定", false))
    }
}

#[async_trait]
impl SecretStore for EncryptedSecretStore {
    async fn set_secret(&self, key: &str, value: &str) -> Result<(), AppErrorDto> {
        let master = self.unlocked_key()?;
        let (nonce, ciphertext) = encrypt(&master, key, value.as_bytes())?;
        let now = now_millis();
        sqlx::query("INSERT INTO encrypted_secrets (secret_ref, nonce, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(secret_ref) DO UPDATE SET nonce=excluded.nonce, ciphertext=excluded.ciphertext, updated_at=excluded.updated_at")
            .bind(key).bind(nonce).bind(ciphertext).bind(now).bind(now).execute(&self.db).await.map_err(AppErrorDto::database)?;
        Ok(())
    }

    async fn get_secret(&self, key: &str) -> Result<String, AppErrorDto> {
        let master = self.unlocked_key()?;
        let row =
            sqlx::query("SELECT nonce, ciphertext FROM encrypted_secrets WHERE secret_ref = ?")
                .bind(key)
                .fetch_optional(&self.db)
                .await
                .map_err(AppErrorDto::database)?
                .ok_or_else(|| {
                    AppErrorDto::new(AppErrorCode::SecretNotFound, "Secret not found", false)
                })?;
        let plaintext = decrypt(
            &master,
            key,
            &row.get::<Vec<u8>, _>("nonce"),
            &row.get::<Vec<u8>, _>("ciphertext"),
        )?;
        String::from_utf8(plaintext).map_err(|e| {
            AppErrorDto::with_details(
                AppErrorCode::SecretStoreError,
                "凭据内容无效",
                e.to_string(),
                false,
            )
        })
    }

    async fn delete_secret(&self, key: &str) -> Result<(), AppErrorDto> {
        self.unlocked_key()?;
        sqlx::query("DELETE FROM encrypted_secrets WHERE secret_ref = ?")
            .bind(key)
            .execute(&self.db)
            .await
            .map_err(AppErrorDto::database)?;
        Ok(())
    }
}

fn derive_key(
    password: &str,
    salt: &[u8],
    memory: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Vec<u8>, AppErrorDto> {
    let params = Params::new(memory, iterations, parallelism, Some(32)).map_err(|e| {
        AppErrorDto::with_details(
            AppErrorCode::SecretStoreError,
            "无效的密钥派生参数",
            e.to_string(),
            false,
        )
    })?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut output = vec![0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut output)
        .map_err(|e| {
            AppErrorDto::with_details(
                AppErrorCode::SecretStoreError,
                "主密钥派生失败",
                e.to_string(),
                false,
            )
        })?;
    Ok(output)
}

fn encrypt(key: &[u8], aad: &str, plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), AppErrorDto> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| AppErrorDto::new(AppErrorCode::SecretStoreError, "无效的主密钥", false))?;
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| AppErrorDto::new(AppErrorCode::SecretStoreError, "凭据加密失败", false))?;
    Ok((nonce.to_vec(), ciphertext))
}

fn decrypt(key: &[u8], aad: &str, nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, AppErrorDto> {
    if nonce.len() != 24 {
        return Err(AppErrorDto::new(
            AppErrorCode::SecretStoreError,
            "凭据 nonce 无效",
            false,
        ));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| AppErrorDto::new(AppErrorCode::SecretStoreError, "无效的主密钥", false))?;
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| {
            AppErrorDto::new(
                AppErrorCode::SecretStoreError,
                "凭据解密或完整性校验失败",
                false,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_round_trip_preserves_secret() {
        let key = derive_key("admin", b"0123456789abcdef", 1024, 1, 1).unwrap();
        let (nonce, ciphertext) = encrypt(&key, "host:1:password", b"secret-value").unwrap();
        assert_eq!(
            decrypt(&key, "host:1:password", &nonce, &ciphertext).unwrap(),
            b"secret-value"
        );
    }

    #[test]
    fn wrong_password_cannot_decrypt() {
        let salt = b"0123456789abcdef";
        let key = derive_key("admin", salt, 1024, 1, 1).unwrap();
        let wrong_key = derive_key("wrong", salt, 1024, 1, 1).unwrap();
        let (nonce, ciphertext) = encrypt(&key, "vault-check", VAULT_CHECK).unwrap();
        assert!(decrypt(&wrong_key, "vault-check", &nonce, &ciphertext).is_err());
    }

    #[test]
    fn associated_data_prevents_secret_swapping() {
        let key = derive_key("admin", b"0123456789abcdef", 1024, 1, 1).unwrap();
        let (nonce, ciphertext) = encrypt(&key, "host:1:password", b"secret-value").unwrap();
        assert!(decrypt(&key, "host:2:password", &nonce, &ciphertext).is_err());
    }
}
