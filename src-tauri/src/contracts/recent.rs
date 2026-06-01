use crate::contracts::{AppErrorCode, ConnectionStatus, EpochMillis, HostId, SessionId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentSessionDto {
    pub id: String,
    pub host_id: HostId,
    pub session_id: Option<SessionId>,
    pub started_at: EpochMillis,
    pub ended_at: Option<EpochMillis>,
    pub status: ConnectionStatus,
    pub error_code: Option<AppErrorCode>,
    pub error_message: Option<String>,
    pub duration_seconds: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRecentSessionsInput {
    pub limit: Option<u32>,
    pub host_id: Option<HostId>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRecentSessionsResult {
    pub sessions: Vec<RecentSessionDto>,
}
