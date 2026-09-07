use crate::app_state::AppState;
use crate::contracts::AppErrorCode;
use crate::contracts::{
    AppErrorDto, DeleteTrustedHostKeyInput, DeleteTrustedHostKeyResult, SshConnectInput,
    SshConnectResult, SshDataEvent, SshDisconnectInput, SshResizeInput, SshWriteInput,
    TrustHostKeyInput, TrustedHostKey,
};
use crate::ssh::client::connect_ssh_transport;
use tauri::{ipc::Channel, AppHandle, State};

#[tauri::command]
pub async fn ssh_ack_output(
    state: State<'_, AppState>,
    input: crate::contracts::SshOutputAckInput,
) -> Result<(), AppErrorDto> {
    state
        .session_manager
        .acknowledge_output(&input.session_id, input.bytes as usize)
        .await;
    Ok(())
}

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

#[tauri::command]
pub async fn ssh_trust_host_key(
    state: State<'_, AppState>,
    input: TrustHostKeyInput,
) -> Result<(), AppErrorDto> {
    let host = state.host_service.get_host(&input.host_id).await?;
    let host_key_store = state.host_key_store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session = connect_ssh_transport(&host.hostname, host.port, host.connect_timeout_ms)?;
        host_key_store.trust(
            &session,
            &host.hostname,
            host.port,
            &input.expected_fingerprint,
        )
    })
    .await
    .map_err(|error| {
        AppErrorDto::with_details(
            AppErrorCode::Unknown,
            "SSH 主机密钥确认任务意外停止",
            error.to_string(),
            true,
        )
    })?
}

#[tauri::command]
pub async fn ssh_list_trusted_host_keys(
    state: State<'_, AppState>,
) -> Result<Vec<TrustedHostKey>, AppErrorDto> {
    let host_key_store = state.host_key_store.clone();
    tauri::async_runtime::spawn_blocking(move || host_key_store.list_trusted())
        .await
        .map_err(host_key_task_error)?
}

#[tauri::command]
pub async fn ssh_delete_trusted_host_key(
    state: State<'_, AppState>,
    input: DeleteTrustedHostKeyInput,
) -> Result<DeleteTrustedHostKeyResult, AppErrorDto> {
    let host_key_store = state.host_key_store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        host_key_store
            .delete_trusted(&input.id)
            .map(|deleted| DeleteTrustedHostKeyResult { deleted })
    })
    .await
    .map_err(host_key_task_error)?
}

fn host_key_task_error(error: impl ToString) -> AppErrorDto {
    AppErrorDto::with_details(
        AppErrorCode::Unknown,
        "SSH 主机密钥管理任务意外停止",
        error.to_string(),
        true,
    )
}
