use crate::contracts::{
    AppErrorCode, AppErrorDto, SessionId, SshConnectInput, SshConnectResult, SshDataEvent,
    SshDisconnectInput, SshResizeInput, SshWriteInput,
};
use crate::repositories::recent_session_repository::RecentSessionRepository;
use crate::services::host_service::HostService;
use crate::ssh::session_worker::run_session_worker;
use crate::ssh::types::{SessionCommand, SessionHandle, SessionWorkerInput};
use crate::utils::base64::decode_base64;
use crate::utils::ids::new_id;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{ipc::Channel, AppHandle};
use tokio::sync::RwLock;

pub struct SessionManager {
    sessions: RwLock<HashMap<SessionId, SessionHandle>>,
    host_service: Arc<HostService>,
    #[allow(dead_code)]
    recent_repo: Arc<RecentSessionRepository>,
}

impl SessionManager {
    pub fn new(host_service: Arc<HostService>, recent_repo: Arc<RecentSessionRepository>) -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            host_service,
            recent_repo,
        }
    }

    pub async fn connect(
        &self,
        app: AppHandle,
        input: SshConnectInput,
        on_data: Channel<SshDataEvent>,
    ) -> Result<SshConnectResult, AppErrorDto> {
        let session_id = new_id();
        let config = self
            .host_service
            .build_connect_config(&input.host_id, input.initial_cols, input.initial_rows)
            .await?;

        let (command_tx, command_rx) = std::sync::mpsc::channel::<SessionCommand>();
        let handle = SessionHandle {
            session_id: session_id.clone(),
            host_id: config.host_id.clone(),
            command_tx,
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), handle);

        let worker_input = SessionWorkerInput {
            session_id: session_id.clone(),
            config,
            command_rx,
            on_data,
            recent_repo: self.recent_repo.clone(),
        };
        tauri::async_runtime::spawn_blocking(move || run_session_worker(app, worker_input));

        Ok(SshConnectResult { session_id })
    }

    pub async fn write(&self, input: SshWriteInput) -> Result<(), AppErrorDto> {
        let bytes = decode_base64(&input.data_base64)?;
        self.send_command(&input.session_id, SessionCommand::Write(bytes))
            .await
    }

    pub async fn resize(&self, input: SshResizeInput) -> Result<(), AppErrorDto> {
        self.send_command(
            &input.session_id,
            SessionCommand::Resize {
                cols: input.cols,
                rows: input.rows,
            },
        )
        .await
    }

    pub async fn disconnect(&self, input: SshDisconnectInput) -> Result<(), AppErrorDto> {
        self.send_command(&input.session_id, SessionCommand::Disconnect)
            .await?;
        self.sessions.write().await.remove(&input.session_id);
        Ok(())
    }

    async fn send_command(
        &self,
        session_id: &str,
        command: SessionCommand,
    ) -> Result<(), AppErrorDto> {
        let command_name = match &command {
            SessionCommand::Write(_) => "write",
            SessionCommand::Resize { .. } => "resize",
            SessionCommand::Disconnect => "disconnect",
        };
        let command_tx = {
            let sessions = self.sessions.read().await;
            sessions
                .get(session_id)
                .map(|handle| handle.command_tx.clone())
        };

        let Some(command_tx) = command_tx else {
            return Err(AppErrorDto::session_not_found());
        };

        match command_tx.send(command) {
            Ok(()) => Ok(()),
            Err(_) => {
                self.sessions.write().await.remove(session_id);
                crate::app_log!(
                    "[session-manager][{session_id}] command channel closed while sending {command_name}"
                );
                Err(AppErrorDto::new(
                    AppErrorCode::SessionClosed,
                    "Session command channel is closed",
                    false,
                ))
            }
        }
    }
}
