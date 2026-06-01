mod app_state;
mod commands;
mod contracts;
mod db;
mod logging;
mod repositories;
mod secrets;
mod services;
mod ssh;
mod utils;

use app_state::AppState;
use commands::*;
use db::sqlite::init_sqlite;
use repositories::{
    host_repository::HostRepository, recent_session_repository::RecentSessionRepository,
    settings_repository::SettingsRepository,
};
use secrets::file_secret_store::FileSecretStore;
use services::file_transfer_service::FileTransferService;
use services::host_service::HostService;
use services::settings_service::SettingsService;
use ssh::session_manager::SessionManager;
use std::sync::Arc;
use tauri::Manager;

#[cfg(test)]
mod tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            tauri::async_runtime::block_on(async move {
                logging::init(&app_handle)?;
                let db = init_sqlite(&app_handle).await?;

                let host_repo = Arc::new(HostRepository::new(db.clone()));
                let recent_repo = Arc::new(RecentSessionRepository::new(db.clone()));
                let settings_repo = Arc::new(SettingsRepository::new(db.clone()));
                let app_dir = app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|err| anyhow::anyhow!("failed to get app data dir: {err}"))?;
                std::fs::create_dir_all(&app_dir)?;
                let secret_cache_path = app_dir.join("wmcssh.json");
                let secret_store = Arc::new(FileSecretStore::new(secret_cache_path));

                let host_service =
                    Arc::new(HostService::new(host_repo.clone(), secret_store.clone()));
                let file_transfer_service =
                    Arc::new(FileTransferService::new(host_service.clone()));
                let session_manager = Arc::new(SessionManager::new(
                    host_service.clone(),
                    recent_repo.clone(),
                ));
                let settings_service = Arc::new(SettingsService::new(settings_repo));

                let state = AppState {
                    db,
                    host_service,
                    file_transfer_service,
                    session_manager,
                    recent_repo,
                    settings_service,
                    secret_store,
                };

                app_handle.manage(state);

                Ok::<(), anyhow::Error>(())
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_host,
            duplicate_host,
            update_host,
            delete_host,
            get_host,
            list_hosts,
            ssh_open_file_transfer_session,
            ssh_close_file_transfer_session,
            ssh_list_remote_directory,
            ssh_upload_remote_file,
            ssh_upload_remote_directory,
            ssh_download_remote_file,
            ssh_download_remote_path,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            get_terminal_settings,
            update_terminal_settings,
            reset_terminal_settings,
            list_recent_sessions,
            get_app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
