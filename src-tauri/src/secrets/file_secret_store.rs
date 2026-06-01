use crate::contracts::{AppErrorCode, AppErrorDto};
use crate::secrets::secret_store::SecretStore;
use async_trait::async_trait;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
struct SecretCache {
    loaded: bool,
    values: HashMap<String, String>,
}

pub struct FileSecretStore {
    file_path: PathBuf,
    cache: Mutex<SecretCache>,
}

impl FileSecretStore {
    pub fn new(file_path: impl Into<PathBuf>) -> Self {
        Self {
            file_path: file_path.into(),
            cache: Mutex::new(SecretCache::default()),
        }
    }

    fn load_all(&self) -> Result<HashMap<String, String>, AppErrorDto> {
        let content = match fs::read_to_string(&self.file_path) {
            Ok(content) => content,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(HashMap::new());
            }
            Err(err) => {
                return Err(AppErrorDto::with_details(
                    AppErrorCode::SecretStoreError,
                    "Failed to read local secret file",
                    err.to_string(),
                    false,
                ));
            }
        };

        serde_json::from_str(&content).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::SecretStoreError,
                "Failed to parse local secret file",
                err.to_string(),
                false,
            )
        })
    }

    fn ensure_cache_loaded(&self) -> Result<(), AppErrorDto> {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if cache.loaded {
            return Ok(());
        }

        cache.values = self.load_all()?;
        cache.loaded = true;
        Ok(())
    }

    fn read_cached_value(&self, key: &str) -> Result<Option<String>, AppErrorDto> {
        self.ensure_cache_loaded()?;
        let cache = self
            .cache
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(cache.values.get(key).cloned())
    }

    fn update_cached_values<F>(&self, update: F) -> Result<(), AppErrorDto>
    where
        F: FnOnce(&mut HashMap<String, String>),
    {
        self.ensure_cache_loaded()?;
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        update(&mut cache.values);
        self.save_all(&cache.values)
    }

    fn save_all(&self, values: &HashMap<String, String>) -> Result<(), AppErrorDto> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                AppErrorDto::with_details(
                    AppErrorCode::SecretStoreError,
                    "Failed to prepare local secret file",
                    err.to_string(),
                    false,
                )
            })?;
        }

        let serialized = serde_json::to_string_pretty(values).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::SecretStoreError,
                "Failed to serialize local secret file",
                err.to_string(),
                false,
            )
        })?;

        fs::write(&self.file_path, serialized).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::SecretStoreError,
                "Failed to write local secret file",
                err.to_string(),
                false,
            )
        })
    }
}

#[async_trait]
impl SecretStore for FileSecretStore {
    async fn set_secret(&self, key: &str, value: &str) -> Result<(), AppErrorDto> {
        crate::app_log!("[file-secret-store][set] key={key}");
        self.update_cached_values(|values| {
            values.insert(key.to_string(), value.to_string());
        })
    }

    async fn get_secret(&self, key: &str) -> Result<String, AppErrorDto> {
        crate::app_log!("[file-secret-store][get] key={key}");
        self.read_cached_value(key)?.ok_or_else(|| {
            AppErrorDto::new(AppErrorCode::SecretNotFound, "Secret not found", false)
        })
    }

    async fn delete_secret(&self, key: &str) -> Result<(), AppErrorDto> {
        crate::app_log!("[file-secret-store][delete] key={key}");
        self.update_cached_values(|values| {
            values.remove(key);
        })
    }
}
