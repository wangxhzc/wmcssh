use crate::app_state::AppState;
use crate::contracts::{
    AppErrorCode, AppErrorDto, CancelTransferInput, CloseFileTransferSessionInput,
    DownloadRemotePathInput, GetTransferTaskInput, ListRemoteDirectoryInput,
    ListRemoteDirectoryResult, OpenFileTransferSessionInput, OpenFileTransferSessionResult,
    TransferProgress, TransferTask, UploadRemoteDirectoryInput, UploadRemoteFileInput,
};
use tauri::{ipc::Channel, State};

async fn run_blocking<T, F>(operation: F) -> Result<T, AppErrorDto>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppErrorDto> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            AppErrorDto::with_details(
                AppErrorCode::Unknown,
                "File transfer worker stopped unexpectedly",
                error.to_string(),
                true,
            )
        })?
}

#[tauri::command]
pub async fn ssh_open_file_transfer_session(
    state: State<'_, AppState>,
    input: OpenFileTransferSessionInput,
) -> Result<OpenFileTransferSessionResult, AppErrorDto> {
    let service = state.file_transfer_service.clone();
    run_blocking(move || tauri::async_runtime::block_on(service.open_file_transfer_session(input)))
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
    let service = state.file_transfer_service.clone();
    run_blocking(move || tauri::async_runtime::block_on(service.list_remote_directory(input))).await
}

#[tauri::command]
pub async fn ssh_enqueue_upload_remote_file(
    state: State<'_, AppState>,
    input: UploadRemoteFileInput,
    on_progress: Channel<TransferProgress>,
) -> Result<TransferTask, AppErrorDto> {
    state
        .file_transfer_service
        .clone()
        .enqueue_upload_remote_file(input, on_progress)
}

#[tauri::command]
pub async fn ssh_enqueue_upload_remote_directory(
    state: State<'_, AppState>,
    input: UploadRemoteDirectoryInput,
    on_progress: Channel<TransferProgress>,
) -> Result<TransferTask, AppErrorDto> {
    state
        .file_transfer_service
        .clone()
        .enqueue_upload_remote_directory(input, on_progress)
}

#[tauri::command]
pub async fn ssh_enqueue_download_remote_path(
    state: State<'_, AppState>,
    input: DownloadRemotePathInput,
    on_progress: Channel<TransferProgress>,
) -> Result<TransferTask, AppErrorDto> {
    state
        .file_transfer_service
        .clone()
        .enqueue_download_remote_path(input, on_progress)
}

#[tauri::command]
pub async fn ssh_list_transfer_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<TransferTask>, AppErrorDto> {
    state.file_transfer_service.list_transfer_tasks()
}

#[tauri::command]
pub async fn ssh_get_transfer_task(
    state: State<'_, AppState>,
    input: GetTransferTaskInput,
) -> Result<TransferTask, AppErrorDto> {
    state
        .file_transfer_service
        .get_transfer_task(&input.transfer_id)
}

#[tauri::command]
pub async fn ssh_cancel_transfer(
    state: State<'_, AppState>,
    input: CancelTransferInput,
) -> Result<TransferTask, AppErrorDto> {
    state
        .file_transfer_service
        .cancel_transfer(&input.transfer_id)
}

#[tauri::command]
pub async fn ssh_delete_transfer_task(
    state: State<'_, AppState>,
    input: GetTransferTaskInput,
) -> Result<(), AppErrorDto> {
    state
        .file_transfer_service
        .delete_transfer_task(&input.transfer_id)
}
