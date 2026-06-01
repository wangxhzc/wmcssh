use crate::app_state::AppState;
use crate::contracts::{
    AppErrorDto, SshConnectInput, SshConnectResult, SshDataEvent, SshDisconnectInput,
    SshResizeInput, SshWriteInput,
};
use tauri::{ipc::Channel, AppHandle, State};

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SshConnectInput,
    on_data: Channel<SshDataEvent>,
) -> Result<SshConnectResult, AppErrorDto> {
    match state.session_manager.connect(app, input, on_data).await {
        Ok(result) => Ok(result),
        Err(error) => {
            crate::app_log!("[tauri][ssh_connect] {} {:?}", error.message, error.details);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    input: SshWriteInput,
) -> Result<(), AppErrorDto> {
    let session_id = input.session_id.clone();
    match state.session_manager.write(input).await {
        Ok(()) => Ok(()),
        Err(error) => {
            crate::app_log!(
                "[tauri][ssh_write:{session_id}] {} {:?}",
                error.message,
                error.details
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    input: SshResizeInput,
) -> Result<(), AppErrorDto> {
    let session_id = input.session_id.clone();
    match state.session_manager.resize(input).await {
        Ok(()) => Ok(()),
        Err(error) => {
            crate::app_log!(
                "[tauri][ssh_resize:{session_id}] {} {:?}",
                error.message,
                error.details
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    input: SshDisconnectInput,
) -> Result<(), AppErrorDto> {
    let session_id = input.session_id.clone();
    match state.session_manager.disconnect(input).await {
        Ok(()) => Ok(()),
        Err(error) => {
            crate::app_log!(
                "[tauri][ssh_disconnect:{session_id}] {} {:?}",
                error.message,
                error.details
            );
            Err(error)
        }
    }
}
