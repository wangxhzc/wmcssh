use serde::{Deserialize, Serialize};
use std::{path::Path, sync::OnceLock};

static CONFIG: OnceLock<TransferConfig> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferConfig {
    pub max_directory_files: usize,
    pub max_delete_entries: usize,
    pub max_directory_depth: usize,
    pub max_retained_tasks: usize,
}

impl Default for TransferConfig {
    fn default() -> Self {
        Self {
            max_directory_files: 1000,
            max_delete_entries: 1000,
            max_directory_depth: 10,
            max_retained_tasks: 200,
        }
    }
}

impl TransferConfig {
    fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(self.max_directory_files > 0, "maxDirectoryFiles 必须大于 0");
        anyhow::ensure!(self.max_delete_entries > 0, "maxDeleteEntries 必须大于 0");
        anyhow::ensure!(
            (1..=128).contains(&self.max_directory_depth),
            "maxDirectoryDepth 必须在 1 到 128 之间"
        );
        anyhow::ensure!(self.max_retained_tasks > 0, "maxRetainedTasks 必须大于 0");
        Ok(())
    }
}

pub fn load(app_dir: &Path) -> anyhow::Result<()> {
    let config = read_config(app_dir)?;
    CONFIG
        .set(config)
        .map_err(|_| anyhow::anyhow!("传输配置已加载"))
}

fn read_config(app_dir: &Path) -> anyhow::Result<TransferConfig> {
    let path = app_dir.join("transfer-config.json");
    let config = match std::fs::read(&path) {
        Ok(contents) => serde_json::from_slice::<TransferConfig>(&contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let defaults = TransferConfig::default();
            std::fs::write(&path, serde_json::to_vec_pretty(&defaults)?)?;
            Ok(defaults)
        }
        Err(error) => return Err(error.into()),
    }
    .map_err(|error| anyhow::anyhow!("{}: {error}", path.display()))?;
    config
        .validate()
        .map_err(|error| anyhow::anyhow!("{}: {error}", path.display()))?;
    Ok(config)
}

pub fn get() -> &'static TransferConfig {
    CONFIG.get_or_init(TransferConfig::default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_defaults_then_reads_edits_without_overwriting() {
        let dir = std::env::temp_dir().join(crate::utils::ids::new_id());
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_config(&dir).unwrap().max_directory_files, 1000);
        let path = dir.join("transfer-config.json");
        let custom = r#"{"maxDirectoryFiles":5000,"maxDeleteEntries":8000,"maxDirectoryDepth":20,"maxRetainedTasks":500}"#;
        std::fs::write(&path, custom).unwrap();
        let config = read_config(&dir).unwrap();
        assert_eq!(config.max_directory_files, 5000);
        assert_eq!(config.max_delete_entries, 8000);
        assert_eq!(config.max_directory_depth, 20);
        assert_eq!(config.max_retained_tasks, 500);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), custom);
        std::fs::write(&path, "invalid json").unwrap();
        assert!(read_config(&dir)
            .unwrap_err()
            .to_string()
            .contains("transfer-config.json"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid json");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn partial_config_preserves_defaults() {
        let config: TransferConfig = serde_json::from_str(r#"{"maxDirectoryFiles":5000}"#).unwrap();
        assert_eq!(config.max_directory_files, 5000);
        assert_eq!(config.max_delete_entries, 1000);
        assert_eq!(config.max_directory_depth, 10);
        assert_eq!(config.max_retained_tasks, 200);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn rejects_invalid_limits_and_unknown_keys() {
        for json in [
            r#"{"maxDirectoryFiles":0}"#,
            r#"{"maxDeleteEntries":0}"#,
            r#"{"maxRetainedTasks":0}"#,
            r#"{"maxDirectoryDepth":129}"#,
            r#"{"maxDirectoryDepth":0}"#,
        ] {
            assert!(serde_json::from_str::<TransferConfig>(json)
                .unwrap()
                .validate()
                .is_err());
        }
        assert!(serde_json::from_str::<TransferConfig>(r#"{"maxFiles":3}"#).is_err());
    }
}
