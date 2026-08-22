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
use secrets::encrypted_secret_store::EncryptedSecretStore;
use serde::{Deserialize, Serialize};
use services::file_transfer_service::FileTransferService;
use services::host_service::HostService;
use services::settings_service::SettingsService;
use ssh::host_key::HostKeyStore;
use ssh::session_manager::SessionManager;
use std::sync::Arc;
use tauri::{Manager, PhysicalSize, WindowEvent};

const WINDOW_STATE_FILE: &str = "window-state.json";
const MIN_WINDOW_WIDTH: f64 = 1280.0;
const MIN_WINDOW_HEIGHT: f64 = 720.0;

#[derive(Deserialize, Serialize)]
struct WindowSizeState {
    width: f64,
    height: f64,
}

fn restore_window_size(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(app_dir) = app.path().app_data_dir() else {
        return;
    };
    let Ok(contents) = std::fs::read_to_string(app_dir.join(WINDOW_STATE_FILE)) else {
        return;
    };
    let Ok(size) = serde_json::from_str::<WindowSizeState>(&contents) else {
        return;
    };

    if size.width.is_finite() && size.height.is_finite() {
        let _ = window.set_size(tauri::LogicalSize::new(
            size.width.max(MIN_WINDOW_WIDTH),
            size.height.max(MIN_WINDOW_HEIGHT),
        ));
    }
}

fn save_window_size(window: &tauri::Window, size: &PhysicalSize<u32>) {
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let Ok(scale_factor) = window.scale_factor() else {
        return;
    };
    let Ok(app_dir) = window.app_handle().path().app_data_dir() else {
        return;
    };
    if std::fs::create_dir_all(&app_dir).is_err() {
        return;
    }

    let state = WindowSizeState {
        width: f64::from(size.width) / scale_factor,
        height: f64::from(size.height) / scale_factor,
    };
    if let Ok(contents) = serde_json::to_vec(&state) {
        let _ = std::fs::write(app_dir.join(WINDOW_STATE_FILE), contents);
    }
}

#[cfg(test)]
mod tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            restore_window_size(app);
            if let Some(window) = app.get_webview_window("main") {
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    let _ = window.center();
                });
            }
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
                let host_key_store = Arc::new(HostKeyStore::new(app_dir.join("known_hosts")));
                let vault = Arc::new(EncryptedSecretStore::new(db.clone(), secret_cache_path));
                let secret_store: secrets::secret_store::DynSecretStore = vault.clone();

                let host_service =
                    Arc::new(HostService::new(host_repo.clone(), secret_store.clone()));
                let file_transfer_service = Arc::new(FileTransferService::new(
                    host_service.clone(),
                    host_key_store.clone(),
                ));
                let session_manager = Arc::new(SessionManager::new(
                    host_service.clone(),
                    recent_repo.clone(),
                    host_key_store.clone(),
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
                    vault,
                    host_key_store,
                };

                app_handle.manage(state);

                Ok::<(), anyhow::Error>(())
            })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Resized(size) = event {
                save_window_size(window, size);
            }
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
            ssh_enqueue_upload_remote_file,
            ssh_enqueue_upload_remote_directory,
            ssh_enqueue_download_remote_path,
            ssh_list_transfer_tasks,
            ssh_get_transfer_task,
            ssh_cancel_transfer,
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ssh_trust_host_key,
            ssh_list_trusted_host_keys,
            ssh_delete_trusted_host_key,
            get_terminal_settings,
            update_terminal_settings,
            reset_terminal_settings,
            list_recent_sessions,
            get_app_info,
            get_vault_status,
            initialize_vault,
            unlock_vault,
            lock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
