use crate::contracts::{EpochMillis, GroupId, HostId, TagId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Failed,
    AuthFailed,
    Timeout,
    NetworkError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDto {
    pub id: TagId,
    pub name: String,
    pub color: Option<String>,
    pub created_at: EpochMillis,
    pub updated_at: EpochMillis,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDto {
    pub id: HostId,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub has_password: bool,
    pub private_key_path: Option<String>,
    pub has_passphrase: bool,
    pub group_id: Option<GroupId>,
    pub tags: Vec<TagDto>,
    pub connect_timeout_ms: u64,
    pub keepalive_interval_secs: u64,
    pub startup_command: Option<String>,
    pub terminal_theme: Option<String>,
    pub last_connected_at: Option<EpochMillis>,
    pub last_status: Option<ConnectionStatus>,
    pub last_error_message: Option<String>,
    pub created_at: EpochMillis,
    pub updated_at: EpochMillis,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHostInput {
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub group_id: Option<GroupId>,
    pub tag_ids: Option<Vec<TagId>>,
    pub connect_timeout_ms: Option<u64>,
    pub keepalive_interval_secs: Option<u64>,
    pub startup_command: Option<String>,
    pub terminal_theme: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHostInput {
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub auth_type: Option<AuthType>,
    pub password: Option<SecretUpdate>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<SecretUpdate>,
    pub group_id: Option<Option<GroupId>>,
    pub tag_ids: Option<Vec<TagId>>,
    pub connect_timeout_ms: Option<u64>,
    pub keepalive_interval_secs: Option<u64>,
    pub startup_command: Option<Option<String>>,
    pub terminal_theme: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateHostInput {
    pub host_id: HostId,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", tag = "action", content = "value")]
pub enum SecretUpdate {
    Keep,
    Replace(String),
    Clear,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFilter {
    pub keyword: Option<String>,
    pub group_id: Option<GroupId>,
    pub tag_ids: Option<Vec<TagId>>,
    pub auth_type: Option<AuthType>,
    pub recently_connected: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostListResult {
    pub hosts: Vec<HostDto>,
}
