use crate::contracts::{HostId, SessionId, SshDataEvent};
use crate::repositories::recent_session_repository::RecentSessionRepository;
use std::sync::Arc;
use tauri::ipc::Channel;

#[derive(Debug, Clone)]
pub enum AuthConfig {
    Password {
        password: String,
    },
    PrivateKey {
        private_key_path: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct ConnectConfig {
    pub host_id: HostId,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthConfig,
    pub connect_timeout_ms: u64,
    pub keepalive_interval_secs: u64,
    pub initial_cols: u16,
    pub initial_rows: u16,
    pub startup_command: Option<String>,
}

#[derive(Debug)]
pub enum SessionCommand {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct SessionHandle {
    pub session_id: SessionId,
    pub host_id: HostId,
    pub command_tx: std::sync::mpsc::Sender<SessionCommand>,
}

pub struct SessionWorkerInput {
    pub session_id: SessionId,
    pub config: ConnectConfig,
    pub command_rx: std::sync::mpsc::Receiver<SessionCommand>,
    pub on_data: Channel<SshDataEvent>,
    pub recent_repo: Arc<RecentSessionRepository>,
}
