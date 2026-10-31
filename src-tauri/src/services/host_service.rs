use crate::contracts::{
    AppErrorCode, AppErrorDto, AuthType, CreateHostInput, DuplicateHostInput, HostDto, HostFilter,
    SecretUpdate, SshConnectInput, UpdateHostInput,
};
use crate::repositories::host_repository::{CreateHostRecord, HostRepository, UpdateHostRecord};
use crate::secrets::secret_store::{host_passphrase_ref, host_password_ref, DynSecretStore};
use crate::ssh::types::{AuthConfig, ConnectConfig};
use crate::utils::{ids::new_id, time::now_millis};
use std::sync::Arc;

pub struct HostService {
    host_repo: Arc<HostRepository>,
    secret_store: DynSecretStore,
}

impl HostService {
    pub fn new(host_repo: Arc<HostRepository>, secret_store: DynSecretStore) -> Self {
        Self {
            host_repo,
            secret_store,
        }
    }

    pub async fn move_host(
        &self,
        input: crate::contracts::MoveHostInput,
    ) -> Result<(), AppErrorDto> {
        self.host_repo.move_host(input).await
    }

    pub async fn create_host(&self, input: CreateHostInput) -> Result<HostDto, AppErrorDto> {
        self.validate_host_input(
            &input.name,
            &input.hostname,
            &input.username,
            input.port,
            &input.auth_type,
        )?;
        let host_id = new_id();
        let now = now_millis();
        let (password_ref, passphrase_ref) = self.persist_create_secrets(&host_id, &input).await?;
        crate::app_log!(
            "[host-service][create_host] host_id={host_id} auth_type={:?} password_ref={:?} passphrase_ref={:?}",
            input.auth_type, password_ref, passphrase_ref
        );

        let record = CreateHostRecord {
            id: host_id,
            name: input.name,
            hostname: input.hostname,
            port: input.port,
            username: input.username,
            auth_type: input.auth_type,
            password_ref,
            private_key_path: input.private_key_path,
            private_key_ref: None,
            passphrase_ref,
            group_id: input.group_id,
            tag_ids: input.tag_ids.unwrap_or_default(),
            startup_command: input.startup_command,
            terminal_theme: input.terminal_theme,
            connect_timeout_ms: input.connect_timeout_ms.unwrap_or(10_000),
            keepalive_interval_secs: input.keepalive_interval_secs.unwrap_or(30),
            created_at: now,
            updated_at: now,
        };

        let saved = self.host_repo.create_host(record).await?;
        self.host_repo.to_host_dto(saved).await
    }

    pub async fn update_host(
        &self,
        host_id: &str,
        input: UpdateHostInput,
    ) -> Result<HostDto, AppErrorDto> {
        let current = self.host_repo.get_host(host_id).await?;
        let current_auth_type = parse_auth_type(&current.auth_type)?;

        let name = input.name.unwrap_or(current.name);
        let hostname = input.hostname.unwrap_or(current.hostname);
        let port = input.port.unwrap_or(current.port as u16);
        let username = input.username.unwrap_or(current.username);
        let auth_type = input.auth_type.unwrap_or(current_auth_type);
        let group_id = input.group_id.unwrap_or(current.group_id);
        let tag_ids = match input.tag_ids {
            Some(tag_ids) => tag_ids,
            None => self
                .host_repo
                .list_tags_for_host(host_id)
                .await?
                .into_iter()
                .map(|tag| tag.id)
                .collect(),
        };
        let startup_command = match input.startup_command {
            Some(value) => value,
            None => current.startup_command.clone(),
        };
        let terminal_theme = match input.terminal_theme {
            Some(value) => value,
            None => current.terminal_theme.clone(),
        };
        let connect_timeout_ms = input
            .connect_timeout_ms
            .unwrap_or(current.connect_timeout_ms as u64);
        let keepalive_interval_secs = input
            .keepalive_interval_secs
            .unwrap_or(current.keepalive_interval_secs as u64);

        self.validate_host_input(&name, &hostname, &username, port, &auth_type)?;

        // New references keep the original credentials usable until the host transaction commits.
        let mut new_secrets = Vec::new();
        let mut old_secrets = Vec::new();
        let prepared = async {
            let password_ref = self
                .prepare_secret_update(
                    &host_password_ref(host_id),
                    current.password_ref.clone(),
                    input.password,
                    &mut new_secrets,
                    &mut old_secrets,
                )
                .await?;
            let passphrase_ref = self
                .prepare_secret_update(
                    &host_passphrase_ref(host_id),
                    current.passphrase_ref.clone(),
                    input.private_key_passphrase,
                    &mut new_secrets,
                    &mut old_secrets,
                )
                .await?;
            Ok::<_, AppErrorDto>((password_ref, passphrase_ref))
        }
        .await;
        let (password_ref, passphrase_ref) = match prepared {
            Ok(refs) => refs,
            Err(error) => {
                self.delete_secrets(&new_secrets).await;
                return Err(error);
            }
        };

        let private_key_path = input.private_key_path.or(current.private_key_path);
        let updated = self
            .host_repo
            .update_host(UpdateHostRecord {
                id: current.id,
                name,
                hostname,
                port,
                username,
                auth_type,
                password_ref,
                private_key_path,
                private_key_ref: current.private_key_ref,
                passphrase_ref,
                group_id,
                tag_ids,
                startup_command,
                terminal_theme,
                connect_timeout_ms,
                keepalive_interval_secs,
                updated_at: now_millis(),
            })
            .await;
        let updated = match updated {
            Ok(record) => record,
            Err(error) => {
                self.delete_secrets(&new_secrets).await;
                return Err(error);
            }
        };
        self.delete_secrets(&old_secrets).await;

        self.host_repo.to_host_dto(updated).await
    }

    async fn prepare_secret_update(
        &self,
        base_ref: &str,
        current_ref: Option<String>,
        update: Option<SecretUpdate>,
        new_secrets: &mut Vec<String>,
        old_secrets: &mut Vec<String>,
    ) -> Result<Option<String>, AppErrorDto> {
        let replacement = match update {
            None | Some(SecretUpdate::Keep) => return Ok(current_ref),
            Some(SecretUpdate::Clear) => None,
            Some(SecretUpdate::Replace(value)) => {
                let key = format!("{base_ref}:{}", new_id());
                self.set_secret(&key, &value).await?;
                new_secrets.push(key.clone());
                Some(key)
            }
        };
        if let Some(key) = current_ref {
            old_secrets.push(key);
        }
        Ok(replacement)
    }

    async fn delete_secrets(&self, keys: &[String]) {
        for key in keys {
            if let Err(error) = self.secret_store.delete_secret(key).await {
                crate::app_log!(
                    "[host-service] credential cleanup failed code={:?}",
                    error.code
                );
            }
        }
    }

    pub async fn duplicate_host(&self, input: DuplicateHostInput) -> Result<HostDto, AppErrorDto> {
        let source = self.host_repo.get_host(&input.host_id).await?;
        let source_auth_type = parse_auth_type(&source.auth_type)?;
        let tag_ids = self
            .host_repo
            .list_tags_for_host(&input.host_id)
            .await?
            .into_iter()
            .map(|tag| tag.id)
            .collect::<Vec<_>>();

        let new_host_id = new_id();
        let now = now_millis();

        let password_ref = if let Some(source_password_ref) = source.password_ref.as_ref() {
            let password_value = self.secret_store.get_secret(source_password_ref).await?;
            let key = host_password_ref(&new_host_id);
            self.set_secret(&key, &password_value).await?;
            Some(key)
        } else {
            None
        };

        let passphrase_ref = if let Some(source_passphrase_ref) = source.passphrase_ref.as_ref() {
            let passphrase_value = self.secret_store.get_secret(source_passphrase_ref).await?;
            let key = host_passphrase_ref(&new_host_id);
            self.set_secret(&key, &passphrase_value).await?;
            Some(key)
        } else {
            None
        };

        self.validate_host_input(
            &input.name,
            &source.hostname,
            &source.username,
            source.port as u16,
            &source_auth_type,
        )?;

        let record = CreateHostRecord {
            id: new_host_id,
            name: input.name.trim().to_string(),
            hostname: source.hostname,
            port: source.port as u16,
            username: source.username,
            auth_type: source_auth_type,
            password_ref,
            private_key_path: source.private_key_path,
            private_key_ref: source.private_key_ref,
            passphrase_ref,
            group_id: source.group_id,
            tag_ids,
            startup_command: source.startup_command,
            terminal_theme: source.terminal_theme,
            connect_timeout_ms: source.connect_timeout_ms as u64,
            keepalive_interval_secs: source.keepalive_interval_secs as u64,
            created_at: now,
            updated_at: now,
        };

        let saved = self.host_repo.create_host(record).await?;
        self.host_repo.to_host_dto(saved).await
    }

    pub async fn get_host(&self, host_id: &str) -> Result<HostDto, AppErrorDto> {
        let record = self.host_repo.get_host(host_id).await?;
        self.host_repo.to_host_dto(record).await
    }

    pub async fn list_hosts(
        &self,
        filter: Option<HostFilter>,
    ) -> Result<Vec<HostDto>, AppErrorDto> {
        let records = self.host_repo.list_hosts(filter).await?;
        self.host_repo.to_host_dtos(records).await
    }

    pub async fn delete_host(&self, host_id: &str) -> Result<(), AppErrorDto> {
        let host = self.host_repo.get_host(host_id).await?;
        self.host_repo.delete_host(host_id).await?;

        if let Some(key) = host.password_ref {
            let _ = self.secret_store.delete_secret(&key).await;
        }
        if let Some(key) = host.passphrase_ref {
            let _ = self.secret_store.delete_secret(&key).await;
        }
        Ok(())
    }

    pub async fn build_connect_config(
        &self,
        host_id: &str,
        initial_cols: u16,
        initial_rows: u16,
    ) -> Result<ConnectConfig, AppErrorDto> {
        let host = self.host_repo.get_host(host_id).await?;
        let auth_type = parse_auth_type(&host.auth_type)?;
        crate::app_log!(
            "[host-service][build_connect_config] host_id={host_id} auth_type={:?} password_ref={:?} passphrase_ref={:?}",
            auth_type, host.password_ref, host.passphrase_ref
        );

        let auth = match auth_type {
            AuthType::Password => {
                let password_ref = host.password_ref.clone().ok_or_else(|| {
                    AppErrorDto::new(
                        AppErrorCode::SecretNotFound,
                        "Password reference not found",
                        false,
                    )
                })?;
                let password = self.secret_store.get_secret(&password_ref).await?;
                AuthConfig::Password { password }
            }
            AuthType::PrivateKey => {
                let private_key_path = host.private_key_path.clone().ok_or_else(|| {
                    AppErrorDto::new(
                        AppErrorCode::HostInvalid,
                        "Private key path is required",
                        false,
                    )
                })?;
                let passphrase = match host.passphrase_ref.clone() {
                    Some(key) => Some(self.secret_store.get_secret(&key).await?),
                    None => None,
                };
                AuthConfig::PrivateKey {
                    private_key_path,
                    passphrase,
                }
            }
        };

        Ok(ConnectConfig {
            host_id: host.id,
            hostname: host.hostname,
            port: host.port as u16,
            username: host.username,
            auth,
            connect_timeout_ms: host.connect_timeout_ms as u64,
            keepalive_interval_secs: host.keepalive_interval_secs as u64,
            initial_cols,
            initial_rows,
            startup_command: host.startup_command,
        })
    }

    pub async fn build_connect_config_with_credentials(
        &self,
        input: SshConnectInput,
    ) -> Result<ConnectConfig, AppErrorDto> {
        if input.username.is_none() && input.auth_type.is_none() {
            return self
                .build_connect_config(&input.host_id, input.initial_cols, input.initial_rows)
                .await;
        }

        let host = self.host_repo.get_host(&input.host_id).await?;
        let username = input.username.unwrap_or(host.username);
        if username.trim().is_empty() {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "Username is required",
                false,
            ));
        }
        let auth_type = input.auth_type.unwrap_or(parse_auth_type(&host.auth_type)?);
        let auth = match auth_type {
            AuthType::Password => AuthConfig::Password {
                password: match input.password {
                    Some(value) => value,
                    None => {
                        let key = host.password_ref.ok_or_else(|| {
                            AppErrorDto::new(
                                AppErrorCode::SecretNotFound,
                                "Password is required",
                                false,
                            )
                        })?;
                        self.secret_store.get_secret(&key).await?
                    }
                },
            },
            AuthType::PrivateKey => AuthConfig::PrivateKey {
                private_key_path: input
                    .private_key_path
                    .or(host.private_key_path)
                    .ok_or_else(|| {
                        AppErrorDto::new(
                            AppErrorCode::HostInvalid,
                            "Private key path is required",
                            false,
                        )
                    })?,
                passphrase: match input.private_key_passphrase {
                    Some(value) => Some(value),
                    None => match host.passphrase_ref {
                        Some(key) => Some(self.secret_store.get_secret(&key).await?),
                        None => None,
                    },
                },
            },
        };
        Ok(ConnectConfig {
            host_id: host.id,
            hostname: host.hostname,
            port: host.port as u16,
            username,
            auth,
            connect_timeout_ms: host.connect_timeout_ms as u64,
            keepalive_interval_secs: host.keepalive_interval_secs as u64,
            initial_cols: input.initial_cols,
            initial_rows: input.initial_rows,
            startup_command: host.startup_command,
        })
    }

    fn validate_host_input(
        &self,
        _name: &str,
        hostname: &str,
        _username: &str,
        port: u16,
        auth_type: &AuthType,
    ) -> Result<(), AppErrorDto> {
        if hostname.trim().is_empty() {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "Hostname is required",
                false,
            ));
        }
        if port == 0 {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "Port is invalid",
                false,
            ));
        }
        match auth_type {
            AuthType::Password => Ok(()),
            AuthType::PrivateKey => Ok(()),
        }
    }

    async fn persist_create_secrets(
        &self,
        host_id: &str,
        input: &CreateHostInput,
    ) -> Result<(Option<String>, Option<String>), AppErrorDto> {
        let password_ref = match input.password.as_deref() {
            Some(password) => {
                let key = host_password_ref(host_id);
                self.set_secret(&key, password).await?;
                Some(key)
            }
            None => None,
        };

        let passphrase_ref = match input.private_key_passphrase.as_deref() {
            Some(passphrase) => {
                let key = host_passphrase_ref(host_id);
                self.set_secret(&key, passphrase).await?;
                Some(key)
            }
            None => None,
        };

        Ok((password_ref, passphrase_ref))
    }

    async fn set_secret(&self, key: &str, value: &str) -> Result<String, AppErrorDto> {
        crate::app_log!("[host-service][set_secret] key={key}");
        self.secret_store.set_secret(key, value).await?;
        Ok(key.to_string())
    }
}

fn parse_auth_type(value: &str) -> Result<AuthType, AppErrorDto> {
    match value {
        "password" => Ok(AuthType::Password),
        "private_key" => Ok(AuthType::PrivateKey),
        _ => Err(AppErrorDto::new(
            AppErrorCode::HostInvalid,
            "Invalid auth type",
            false,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::secret_store::SecretStore;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct TestSecrets {
        values: Mutex<HashMap<String, String>>,
        fail_passphrase: Mutex<bool>,
    }

    #[async_trait::async_trait]
    impl SecretStore for TestSecrets {
        async fn set_secret(&self, key: &str, value: &str) -> Result<(), AppErrorDto> {
            if *self.fail_passphrase.lock().unwrap() && key.contains("private_key_passphrase") {
                return Err(AppErrorDto::new(
                    AppErrorCode::SecretStoreError,
                    "Injected failure",
                    false,
                ));
            }
            self.values.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }

        async fn get_secret(&self, key: &str) -> Result<String, AppErrorDto> {
            self.values
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .ok_or_else(|| {
                    AppErrorDto::new(AppErrorCode::SecretNotFound, "Missing secret", false)
                })
        }

        async fn delete_secret(&self, key: &str) -> Result<(), AppErrorDto> {
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
    }

    async fn fixture() -> (HostService, Arc<TestSecrets>, String) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::migrations::run_migrations(&pool).await.unwrap();
        let secrets = Arc::new(TestSecrets::default());
        let service = HostService::new(Arc::new(HostRepository::new(pool)), secrets.clone());
        let host = service
            .create_host(
                serde_json::from_value(serde_json::json!({
                    "name": "test", "hostname": "example.test", "port": 22,
                    "username": "root", "authType": "password", "password": "old",
                    "privateKeyPassphrase": "old-passphrase"
                }))
                .unwrap(),
            )
            .await
            .unwrap();
        (service, secrets, host.id)
    }

    #[tokio::test]
    async fn failed_host_update_preserves_credentials_and_removes_staged_secrets() {
        for action in [
            serde_json::json!({"action": "replace", "value": "new"}),
            serde_json::json!({"action": "clear"}),
        ] {
            let (service, secrets, id) = fixture().await;
            let before = secrets.values.lock().unwrap().clone();
            let input = serde_json::from_value(serde_json::json!({
                "password": action, "groupId": "missing-group"
            }))
            .unwrap();
            assert!(service.update_host(&id, input).await.is_err());
            assert_eq!(*secrets.values.lock().unwrap(), before);
            let config = service.build_connect_config(&id, 80, 24).await.unwrap();
            assert!(matches!(config.auth, AuthConfig::Password { password } if password == "old"));
        }
    }

    #[tokio::test]
    async fn failed_second_secret_write_cleans_up_first_without_changing_originals() {
        let (service, secrets, id) = fixture().await;
        let before = secrets.values.lock().unwrap().clone();
        *secrets.fail_passphrase.lock().unwrap() = true;
        let input = serde_json::from_value(serde_json::json!({
            "password": {"action": "replace", "value": "new"},
            "privateKeyPassphrase": {"action": "replace", "value": "new-passphrase"}
        }))
        .unwrap();
        assert!(service.update_host(&id, input).await.is_err());
        assert_eq!(*secrets.values.lock().unwrap(), before);
    }

    #[tokio::test]
    async fn committed_update_replaces_references_and_removes_old_credentials() {
        let (service, secrets, id) = fixture().await;
        let input = serde_json::from_value(serde_json::json!({
            "password": {"action": "replace", "value": "new"},
            "privateKeyPassphrase": {"action": "clear"}
        }))
        .unwrap();
        service.update_host(&id, input).await.unwrap();
        let config = service.build_connect_config(&id, 80, 24).await.unwrap();
        assert!(matches!(config.auth, AuthConfig::Password { password } if password == "new"));
        let values = secrets.values.lock().unwrap();
        assert_eq!(values.len(), 1);
        assert!(!values.contains_key(&host_password_ref(&id)));
        assert!(!values.contains_key(&host_passphrase_ref(&id)));
    }
}
