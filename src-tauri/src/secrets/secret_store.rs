use crate::contracts::AppErrorDto;
use async_trait::async_trait;
use std::sync::Arc;

pub type DynSecretStore = Arc<dyn SecretStore + Send + Sync>;

#[async_trait]
pub trait SecretStore {
    async fn set_secret(&self, key: &str, value: &str) -> Result<(), AppErrorDto>;
    async fn get_secret(&self, key: &str) -> Result<String, AppErrorDto>;
    async fn delete_secret(&self, key: &str) -> Result<(), AppErrorDto>;
}

pub fn host_password_ref(host_id: &str) -> String {
    format!("host:{host_id}:password")
}

pub fn host_passphrase_ref(host_id: &str) -> String {
    format!("host:{host_id}:private_key_passphrase")
}
