use crate::contracts::{AuthType, EpochMillis, HostId, SessionId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRemoteDirectoryInput {
    pub transfer_session_id: SessionId,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileTransferSessionInput {
    pub host_id: HostId,
    pub username: Option<String>,
    pub auth_type: Option<AuthType>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileTransferSessionResult {
    pub transfer_session_id: SessionId,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseFileTransferSessionInput {
    pub transfer_session_id: SessionId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteFileEntryType {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub entry_type: RemoteFileEntryType,
    pub size: Option<u64>,
    pub modified_at: Option<EpochMillis>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRemoteDirectoryResult {
    pub host_id: HostId,
    pub path: String,
    pub entries: Vec<RemoteFileEntry>,
    pub fallback_to_root: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRemoteFileInput {
    pub transfer_id: String,
    pub transfer_session_id: SessionId,
    pub remote_dir_path: String,
    pub file_name: String,
    pub local_file_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRemoteDirectoryFilePayload {
    pub relative_path: String,
    pub local_file_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRemoteDirectoryInput {
    pub transfer_id: String,
    pub transfer_session_id: SessionId,
    pub remote_dir_path: String,
    pub directory_name: String,
    pub directories: Vec<String>,
    pub files: Vec<UploadRemoteDirectoryFilePayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTransferInput {
    pub transfer_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub status: TransferStatus,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub current_file: Option<String>,
    pub completed_files: usize,
    pub total_files: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemotePathInput {
    pub transfer_id: String,
    pub transfer_session_id: SessionId,
    pub remote_path: String,
    pub local_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTask {
    pub transfer_id: String,
    pub transfer_session_id: SessionId,
    pub direction: TransferDirection,
    pub status: TransferStatus,
    pub source_path: String,
    pub destination_path: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub current_file: Option<String>,
    pub completed_files: usize,
    pub total_files: usize,
    pub error: Option<crate::contracts::AppErrorDto>,
    pub created_at: EpochMillis,
    pub started_at: Option<EpochMillis>,
    pub finished_at: Option<EpochMillis>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTransferTaskInput {
    pub transfer_id: String,
}
