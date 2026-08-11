use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPasswordInput {
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatusResult {
    pub initialized: bool,
    pub unlocked: bool,
    pub legacy_credentials_detected: bool,
}
