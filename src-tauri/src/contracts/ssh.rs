use crate::contracts::{AppErrorDto, AuthType, EpochMillis, HostId, SessionId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
    Closing,
    Error,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectInput {
    pub host_id: HostId,
    pub initial_cols: u16,
    pub initial_rows: u16,
    pub username: Option<String>,
    pub auth_type: Option<AuthType>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectResult {
    pub session_id: SessionId,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshWriteInput {
    pub session_id: SessionId,
    pub data_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshResizeInput {
    pub session_id: SessionId,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDisconnectInput {
    pub session_id: SessionId,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustHostKeyInput {
    pub host_id: HostId,
    pub expected_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyChallenge {
    pub hostname: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostKey {
    pub id: String,
    pub host_patterns: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub key_type: String,
    pub fingerprint: String,
    pub hashed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTrustedHostKeyInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTrustedHostKeyResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum SshDataEvent {
    Data {
        session_id: SessionId,
        data_base64: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshStatusPayload {
    pub session_id: SessionId,
    pub host_id: HostId,
    pub status: SessionStatus,
    pub message: Option<String>,
    pub at: EpochMillis,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum SshClosedReason {
    UserDisconnect,
    RemoteClosed,
    NetworkError,
    WorkerError,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshClosedPayload {
    pub session_id: SessionId,
    pub host_id: HostId,
    pub reason: SshClosedReason,
    pub message: Option<String>,
    pub at: EpochMillis,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshErrorPayload {
    pub session_id: SessionId,
    pub host_id: Option<HostId>,
    pub error: AppErrorDto,
    pub at: EpochMillis,
}
