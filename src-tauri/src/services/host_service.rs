use crate::contracts::{
    AppErrorCode, AppErrorDto, AuthType, CreateHostInput, DuplicateHostInput, HostDto, HostFilter,
    SecretUpdate, UpdateHostInput,
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

    pub async fn create_host(&self, input: CreateHostInput) -> Result<HostDto, AppErrorDto> {
        self.validate_host_input(
            &input.name,
            &input.hostname,
            &input.username,
            input.port,
            &input.auth_type,
        )?;
        self.validate_create_auth(&input)?;

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

        let final_private_key_path = input
            .private_key_path
            .clone()
            .or(current.private_key_path.clone());
        self.validate_update_auth(
            &auth_type,
            current.password_ref.as_ref(),
            &input.password,
            final_private_key_path.as_ref(),
        )?;

        let mut secrets_to_delete = Vec::new();
        let password_ref = match input.password {
            Some(SecretUpdate::Keep) => current.password_ref.clone(),
            Some(SecretUpdate::Replace(value)) => {
                let key = host_password_ref(host_id);
                self.set_secret(&key, &value).await?;
                Some(key)
            }
            Some(SecretUpdate::Clear) => {
                if let Some(key) = current.password_ref.clone() {
                    secrets_to_delete.push(key);
                }
                None
            }
            None => current.password_ref.clone(),
        };

        let passphrase_ref = match input.private_key_passphrase {
            Some(SecretUpdate::Keep) => current.passphrase_ref.clone(),
            Some(SecretUpdate::Replace(value)) => {
                let key = host_passphrase_ref(host_id);
                self.set_secret(&key, &value).await?;
                Some(key)
            }
            Some(SecretUpdate::Clear) => {
                if let Some(key) = current.passphrase_ref.clone() {
                    secrets_to_delete.push(key);
                }
                None
            }
            None => current.passphrase_ref.clone(),
        };

        for key in secrets_to_delete {
            let _ = self.secret_store.delete_secret(&key).await;
        }

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
            .await?;

        self.host_repo.to_host_dto(updated).await
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

    fn validate_host_input(
        &self,
        name: &str,
        hostname: &str,
        username: &str,
        port: u16,
        auth_type: &AuthType,
    ) -> Result<(), AppErrorDto> {
        if name.trim().is_empty() {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "Host name is required",
                false,
            ));
        }
        if hostname.trim().is_empty() {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "Hostname is required",
                false,
            ));
        }
        if username.trim().is_empty() {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "Username is required",
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

    fn validate_create_auth(&self, input: &CreateHostInput) -> Result<(), AppErrorDto> {
        match input.auth_type {
            AuthType::Password => {
                if is_blank(input.password.as_deref()) {
                    return Err(AppErrorDto::new(
                        AppErrorCode::HostInvalid,
                        "Password is required for password auth",
                        false,
                    ));
                }
            }
            AuthType::PrivateKey => {
                if is_blank(input.private_key_path.as_deref()) {
                    return Err(AppErrorDto::new(
                        AppErrorCode::HostInvalid,
                        "Private key path is required for private key auth",
                        false,
                    ));
                }
            }
        }
        Ok(())
    }

    fn validate_update_auth(
        &self,
        auth_type: &AuthType,
        current_password_ref: Option<&String>,
        password_update: &Option<SecretUpdate>,
        effective_private_key_path: Option<&String>,
    ) -> Result<(), AppErrorDto> {
        match auth_type {
            AuthType::Password => {
                let has_password = match password_update {
                    Some(SecretUpdate::Clear) => false,
                    Some(SecretUpdate::Replace(_)) => true,
                    Some(SecretUpdate::Keep) | None => current_password_ref.is_some(),
                };
                if !has_password {
                    return Err(AppErrorDto::new(
                        AppErrorCode::HostInvalid,
                        "Password is required for password auth",
                        false,
                    ));
                }
            }
            AuthType::PrivateKey => {
                if is_blank(effective_private_key_path.map(String::as_str)) {
                    return Err(AppErrorDto::new(
                        AppErrorCode::HostInvalid,
                        "Private key path is required for private key auth",
                        false,
                    ));
                }
            }
        }
        Ok(())
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

fn is_blank(value: Option<&str>) -> bool {
    value.map(|text| text.trim().is_empty()).unwrap_or(true)
}
