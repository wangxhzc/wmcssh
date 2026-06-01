use crate::repositories::recent_session_repository::RecentSessionRepository;
use crate::secrets::secret_store::DynSecretStore;
use crate::services::file_transfer_service::FileTransferService;
use crate::services::host_service::HostService;
use crate::services::settings_service::SettingsService;
use crate::ssh::session_manager::SessionManager;
use sqlx::SqlitePool;
use std::sync::Arc;

#[allow(dead_code)]
pub struct AppState {
    pub db: SqlitePool,
    pub host_service: Arc<HostService>,
    pub file_transfer_service: Arc<FileTransferService>,
    pub session_manager: Arc<SessionManager>,
    pub recent_repo: Arc<RecentSessionRepository>,
    pub settings_service: Arc<SettingsService>,
    pub secret_store: DynSecretStore,
}
