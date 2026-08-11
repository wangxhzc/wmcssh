use crate::contracts::{EpochMillis, HostId, SessionId};
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryFilePayload {
    pub relative_path: String,
    pub content_base64: String,
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
pub struct CancelUploadInput {
    pub transfer_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    pub transfer_id: String,
    pub uploaded_bytes: u64,
    pub total_bytes: u64,
    pub current_file: String,
    pub completed_files: usize,
    pub total_files: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemoteFileInput {
    pub transfer_session_id: SessionId,
    pub remote_file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemoteFileResult {
    pub file_name: String,
    pub content_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemotePathInput {
    pub transfer_session_id: SessionId,
    pub remote_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemotePathResult {
    pub name: String,
    pub entry_type: RemoteFileEntryType,
    pub content_base64: Option<String>,
    pub directories: Vec<String>,
    pub files: Vec<RemoteDirectoryFilePayload>,
}
