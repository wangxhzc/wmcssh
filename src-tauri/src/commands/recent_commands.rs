use crate::app_state::AppState;
use crate::contracts::{AppErrorDto, ListRecentSessionsInput, ListRecentSessionsResult};
use tauri::State;

#[tauri::command]
pub async fn list_recent_sessions(
    state: State<'_, AppState>,
    input: Option<ListRecentSessionsInput>,
) -> Result<ListRecentSessionsResult, AppErrorDto> {
    state.recent_repo.list_recent_sessions(input).await
}
