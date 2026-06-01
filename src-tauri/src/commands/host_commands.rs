use crate::app_state::AppState;
use crate::contracts::{
    AppErrorDto, CreateHostInput, DuplicateHostInput, HostDto, HostFilter, HostId, UpdateHostInput,
};
use tauri::State;

#[tauri::command]
pub async fn create_host(
    state: State<'_, AppState>,
    input: CreateHostInput,
) -> Result<HostDto, AppErrorDto> {
    match state.host_service.create_host(input).await {
        Ok(host) => Ok(host),
        Err(error) => {
            crate::app_log!("[tauri][create_host] {} {:?}", error.message, error.details);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn get_host(state: State<'_, AppState>, host_id: HostId) -> Result<HostDto, AppErrorDto> {
    match state.host_service.get_host(&host_id).await {
        Ok(host) => Ok(host),
        Err(error) => {
            crate::app_log!(
                "[tauri][get_host:{host_id}] {} {:?}",
                error.message,
                error.details
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn list_hosts(
    state: State<'_, AppState>,
    filter: Option<HostFilter>,
) -> Result<crate::contracts::HostListResult, AppErrorDto> {
    match state.host_service.list_hosts(filter).await {
        Ok(hosts) => Ok(crate::contracts::HostListResult { hosts }),
        Err(error) => {
            crate::app_log!("[tauri][list_hosts] {} {:?}", error.message, error.details);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn delete_host(state: State<'_, AppState>, host_id: HostId) -> Result<(), AppErrorDto> {
    match state.host_service.delete_host(&host_id).await {
        Ok(()) => Ok(()),
        Err(error) => {
            crate::app_log!(
                "[tauri][delete_host:{host_id}] {} {:?}",
                error.message,
                error.details
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn update_host(
    state: State<'_, AppState>,
    host_id: HostId,
    input: UpdateHostInput,
) -> Result<HostDto, AppErrorDto> {
    match state.host_service.update_host(&host_id, input).await {
        Ok(host) => Ok(host),
        Err(error) => {
            crate::app_log!(
                "[tauri][update_host:{host_id}] {} {:?}",
                error.message,
                error.details
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn duplicate_host(
    state: State<'_, AppState>,
    input: DuplicateHostInput,
) -> Result<HostDto, AppErrorDto> {
    let host_id = input.host_id.clone();
    match state.host_service.duplicate_host(input).await {
        Ok(host) => Ok(host),
        Err(error) => {
            crate::app_log!(
                "[tauri][duplicate_host:{host_id}] {} {:?}",
                error.message,
                error.details
            );
            Err(error)
        }
    }
}
