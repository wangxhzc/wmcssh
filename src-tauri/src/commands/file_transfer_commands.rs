use crate::app_state::AppState;
use crate::contracts::{
    AppErrorDto, CloseFileTransferSessionInput, DownloadRemoteFileInput, DownloadRemoteFileResult,
    DownloadRemotePathInput, DownloadRemotePathResult, ListRemoteDirectoryInput,
    ListRemoteDirectoryResult, OpenFileTransferSessionInput, OpenFileTransferSessionResult,
    UploadRemoteDirectoryInput, UploadRemoteFileInput,
};
use tauri::State;

#[tauri::command]
pub async fn ssh_open_file_transfer_session(
    state: State<'_, AppState>,
    input: OpenFileTransferSessionInput,
) -> Result<OpenFileTransferSessionResult, AppErrorDto> {
    state
        .file_transfer_service
        .open_file_transfer_session(input)
        .await
}

#[tauri::command]
pub async fn ssh_close_file_transfer_session(
    state: State<'_, AppState>,
    input: CloseFileTransferSessionInput,
) -> Result<(), AppErrorDto> {
    state
        .file_transfer_service
        .close_file_transfer_session(input)
        .await
}

#[tauri::command]
pub async fn ssh_list_remote_directory(
    state: State<'_, AppState>,
    input: ListRemoteDirectoryInput,
) -> Result<ListRemoteDirectoryResult, AppErrorDto> {
    state
        .file_transfer_service
        .list_remote_directory(input)
        .await
}

#[tauri::command]
pub async fn ssh_upload_remote_file(
    state: State<'_, AppState>,
    input: UploadRemoteFileInput,
) -> Result<(), AppErrorDto> {
    state.file_transfer_service.upload_remote_file(input).await
}

#[tauri::command]
pub async fn ssh_upload_remote_directory(
    state: State<'_, AppState>,
    input: UploadRemoteDirectoryInput,
) -> Result<(), AppErrorDto> {
    state
        .file_transfer_service
        .upload_remote_directory(input)
        .await
}

#[tauri::command]
pub async fn ssh_download_remote_file(
    state: State<'_, AppState>,
    input: DownloadRemoteFileInput,
) -> Result<DownloadRemoteFileResult, AppErrorDto> {
    state
        .file_transfer_service
        .download_remote_file(input)
        .await
}

#[tauri::command]
pub async fn ssh_download_remote_path(
    state: State<'_, AppState>,
    input: DownloadRemotePathInput,
) -> Result<DownloadRemotePathResult, AppErrorDto> {
    state
        .file_transfer_service
        .download_remote_path(input)
        .await
}
