use crate::app_state::AppState;
use crate::contracts::{AppErrorDto, VaultPasswordInput, VaultStatusResult};
use tauri::State;

#[tauri::command]
pub async fn get_vault_status(
    state: State<'_, AppState>,
) -> Result<VaultStatusResult, AppErrorDto> {
    Ok(VaultStatusResult {
        initialized: state.vault.is_initialized().await?,
        unlocked: state.vault.is_unlocked(),
        legacy_credentials_detected: state.vault.has_legacy_credentials(),
    })
}

#[tauri::command]
pub async fn initialize_vault(
    state: State<'_, AppState>,
    input: VaultPasswordInput,
) -> Result<(), AppErrorDto> {
    state.vault.initialize_and_migrate(&input.password).await
}

#[tauri::command]
pub async fn unlock_vault(
    state: State<'_, AppState>,
    input: VaultPasswordInput,
) -> Result<(), AppErrorDto> {
    state.vault.unlock(&input.password).await
}

#[tauri::command]
pub async fn lock_vault(state: State<'_, AppState>) -> Result<(), AppErrorDto> {
    state.vault.lock();
    Ok(())
}
