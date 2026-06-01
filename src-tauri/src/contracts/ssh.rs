use crate::contracts::{AppErrorDto, EpochMillis, HostId, SessionId};
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
