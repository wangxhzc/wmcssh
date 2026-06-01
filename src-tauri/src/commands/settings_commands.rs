use crate::app_state::AppState;
use crate::contracts::{AppErrorDto, TerminalSettingsDto};
use tauri::State;

#[tauri::command]
pub async fn get_terminal_settings(
    state: State<'_, AppState>,
) -> Result<TerminalSettingsDto, AppErrorDto> {
    state.settings_service.get_terminal_settings().await
}

#[tauri::command]
pub async fn update_terminal_settings(
    state: State<'_, AppState>,
    input: TerminalSettingsDto,
) -> Result<TerminalSettingsDto, AppErrorDto> {
    state.settings_service.update_terminal_settings(input).await
}

#[tauri::command]
pub async fn reset_terminal_settings(
    state: State<'_, AppState>,
) -> Result<TerminalSettingsDto, AppErrorDto> {
    state.settings_service.reset_terminal_settings().await
}

#[tauri::command]
pub async fn get_app_info() -> crate::contracts::AppInfoDto {
    crate::contracts::AppInfoDto {
        contract_version: crate::contracts::CONTRACT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}
