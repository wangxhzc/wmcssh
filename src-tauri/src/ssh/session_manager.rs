use crate::contracts::{
    AppErrorCode, AppErrorDto, SessionId, SshConnectInput, SshConnectResult, SshDataEvent,
    SshDisconnectInput, SshResizeInput, SshWriteInput,
};
use crate::repositories::recent_session_repository::RecentSessionRepository;
use crate::services::host_service::HostService;
use crate::ssh::host_key::HostKeyStore;
use crate::ssh::session_worker::run_session_worker;
use crate::ssh::types::{SessionCommand, SessionHandle, SessionWorkerInput};
use crate::utils::base64::decode_base64;
use crate::utils::ids::new_id;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{ipc::Channel, AppHandle};
use tokio::sync::RwLock;

pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<SessionId, SessionHandle>>>,
    host_service: Arc<HostService>,
    #[allow(dead_code)]
    recent_repo: Arc<RecentSessionRepository>,
    host_key_store: Arc<HostKeyStore>,
}

impl SessionManager {
    pub fn new(
        host_service: Arc<HostService>,
        recent_repo: Arc<RecentSessionRepository>,
        host_key_store: Arc<HostKeyStore>,
    ) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            host_service,
            recent_repo,
            host_key_store,
        }
    }

    pub async fn connect(
        &self,
        app: AppHandle,
        input: SshConnectInput,
        on_data: Channel<SshDataEvent>,
    ) -> Result<SshConnectResult, AppErrorDto> {
        let session_id = match input.session_id.as_deref() {
            Some(id) => uuid::Uuid::parse_str(id)
                .map_err(|_| {
                    AppErrorDto::new(AppErrorCode::HostInvalid, "Invalid session ID", false)
                })?
                .to_string(),
            None => new_id(),
        };
        let config = self
            .host_service
            .build_connect_config_with_credentials(input)
            .await?;

        let (command_tx, command_rx) = std::sync::mpsc::sync_channel::<SessionCommand>(256);
        let pending_bytes = Arc::new(AtomicUsize::new(0));
        let pending_output = Arc::new(AtomicUsize::new(0));
        let disconnect_requested = Arc::new(AtomicBool::new(false));
        let handle = SessionHandle {
            session_id: session_id.clone(),
            host_id: config.host_id.clone(),
            command_tx,
            pending_bytes: pending_bytes.clone(),
            pending_output: pending_output.clone(),
            disconnect_requested: disconnect_requested.clone(),
        };

        {
            let mut sessions = self.sessions.write().await;
            if sessions.contains_key(&session_id) {
                return Err(AppErrorDto::new(
                    AppErrorCode::HostInvalid,
                    "Session ID already exists",
                    false,
                ));
            }
            sessions.insert(session_id.clone(), handle);
        }

        let worker_input = SessionWorkerInput {
            session_id: session_id.clone(),
            config,
            command_rx,
            on_data,
            recent_repo: self.recent_repo.clone(),
            host_key_store: self.host_key_store.clone(),
            pending_bytes,
            pending_output,
            disconnect_requested,
        };
        let sessions = self.sessions.clone();
        let worker_session_id = session_id.clone();
        let worker_identity = worker_input.disconnect_requested.clone();
        tauri::async_runtime::spawn(supervise_worker(
            sessions,
            worker_session_id,
            worker_identity,
            move || run_session_worker(app, worker_input),
        ));

        Ok(SshConnectResult { session_id })
    }

    pub fn active_session_count(&self) -> Option<usize> {
        self.sessions.try_read().ok().map(|sessions| sessions.len())
    }

    pub async fn write(&self, input: SshWriteInput) -> Result<(), AppErrorDto> {
        let bytes = decode_base64(&input.data_base64)?;
        self.send_command(&input.session_id, SessionCommand::Write(bytes))
            .await
    }

    pub async fn acknowledge_output(&self, session_id: &str, bytes: usize) {
        if let Some(handle) = self.sessions.read().await.get(session_id) {
            let _ = handle.pending_output.fetch_update(
                Ordering::Relaxed,
                Ordering::Relaxed,
                |current| Some(current.saturating_sub(bytes)),
            );
        }
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
        if let Some(handle) = self.sessions.write().await.remove(&input.session_id) {
            handle.disconnect_requested.store(true, Ordering::Relaxed);
        }
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
        let handle = {
            let sessions = self.sessions.read().await;
            sessions.get(session_id).cloned()
        };

        let Some(handle) = handle else {
            return Err(AppErrorDto::session_not_found());
        };

        let result = try_enqueue(&handle, command);
        if matches!(&result, Err(error) if matches!(error.code, AppErrorCode::SessionClosed)) {
            remove_current_session(&self.sessions, session_id, &handle.disconnect_requested).await;
            crate::app_log!("[session-manager][{session_id}] command channel closed while sending {command_name}");
        }
        result
    }
}

async fn supervise_worker(
    sessions: Arc<RwLock<HashMap<SessionId, SessionHandle>>>,
    session_id: SessionId,
    identity: Arc<AtomicBool>,
    worker: impl FnOnce() + Send + 'static,
) {
    // Await even a panicking worker so every exit removes its handle.
    let _ = tauri::async_runtime::spawn_blocking(worker).await;
    remove_current_session(&sessions, &session_id, &identity).await;
}

async fn remove_current_session(
    sessions: &RwLock<HashMap<SessionId, SessionHandle>>,
    session_id: &str,
    identity: &Arc<AtomicBool>,
) {
    let mut sessions = sessions.write().await;
    if sessions
        .get(session_id)
        .is_some_and(|handle| Arc::ptr_eq(&handle.disconnect_requested, identity))
    {
        sessions.remove(session_id);
    }
}

fn try_enqueue(handle: &SessionHandle, command: SessionCommand) -> Result<(), AppErrorDto> {
    let bytes = match &command {
        SessionCommand::Write(data) => data.len(),
        _ => 0,
    };
    if handle
        .pending_bytes
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            current
                .checked_add(bytes)
                .filter(|total| *total <= 4 * 1024 * 1024)
        })
        .is_err()
    {
        return Err(input_buffer_full());
    }
    match handle.command_tx.try_send(command) {
        Ok(()) => Ok(()),
        Err(std::sync::mpsc::TrySendError::Full(_)) => {
            handle.pending_bytes.fetch_sub(bytes, Ordering::Relaxed);
            Err(input_buffer_full())
        }
        Err(std::sync::mpsc::TrySendError::Disconnected(_)) => {
            handle.pending_bytes.fetch_sub(bytes, Ordering::Relaxed);
            Err(AppErrorDto::new(
                AppErrorCode::SessionClosed,
                "Session command channel is closed",
                false,
            ))
        }
    }
}

fn input_buffer_full() -> AppErrorDto {
    AppErrorDto::new(
        AppErrorCode::InputBufferFull,
        "SSH input queue is full; retry later",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handle(capacity: usize) -> (SessionHandle, std::sync::mpsc::Receiver<SessionCommand>) {
        let (command_tx, rx) = std::sync::mpsc::sync_channel(capacity);
        (
            SessionHandle {
                session_id: "test".into(),
                host_id: "host".into(),
                command_tx,
                pending_bytes: Arc::new(AtomicUsize::new(0)),
                pending_output: Arc::new(AtomicUsize::new(0)),
                disconnect_requested: Arc::new(AtomicBool::new(false)),
            },
            rx,
        )
    }

    #[test]
    fn full_command_queue_rejects_without_losing_capacity_or_closing_session() {
        let (handle, rx) = handle(1);
        try_enqueue(&handle, SessionCommand::Write(vec![1, 2])).unwrap();
        assert!(
            matches!(try_enqueue(&handle, SessionCommand::Write(vec![3])), Err(error) if matches!(error.code, AppErrorCode::InputBufferFull))
        );
        assert_eq!(handle.pending_bytes.load(Ordering::Relaxed), 2);
        assert!(matches!(rx.recv().unwrap(), SessionCommand::Write(data) if data == vec![1, 2]));
        handle.pending_bytes.fetch_sub(2, Ordering::Relaxed);
        try_enqueue(&handle, SessionCommand::Write(vec![3])).unwrap();
        assert!(matches!(rx.recv().unwrap(), SessionCommand::Write(data) if data == vec![3]));
    }

    #[test]
    fn byte_limit_includes_data_already_received_by_worker() {
        let (handle, rx) = handle(2);
        try_enqueue(&handle, SessionCommand::Write(vec![0; 4 * 1024 * 1024])).unwrap();
        let _ = rx.recv().unwrap();
        assert!(
            matches!(try_enqueue(&handle, SessionCommand::Write(vec![1])), Err(error) if matches!(error.code, AppErrorCode::InputBufferFull))
        );
        handle.pending_bytes.fetch_sub(1, Ordering::Relaxed);
        try_enqueue(&handle, SessionCommand::Write(vec![1])).unwrap();
        assert_eq!(
            handle.pending_bytes.load(Ordering::Relaxed),
            4 * 1024 * 1024
        );
    }

    #[test]
    fn closed_worker_rolls_back_reservation() {
        let (handle, rx) = handle(1);
        drop(rx);
        assert!(
            matches!(try_enqueue(&handle, SessionCommand::Write(vec![1])), Err(error) if matches!(error.code, AppErrorCode::SessionClosed))
        );
        assert_eq!(handle.pending_bytes.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn supervisor_cleans_up_normal_and_panicking_workers() {
        for panics in [false, true] {
            let (handle, _rx) = handle(1);
            let identity = handle.disconnect_requested.clone();
            let sessions = Arc::new(RwLock::new(HashMap::from([("test".into(), handle)])));
            supervise_worker(sessions.clone(), "test".into(), identity, move || {
                assert!(!panics, "simulated worker failure");
            })
            .await;
            assert!(sessions.read().await.is_empty());
        }
    }

    #[tokio::test]
    async fn old_worker_cleanup_cannot_remove_a_replacement_with_the_same_id() {
        let (old_handle, _old_rx) = handle(1);
        let (replacement, _new_rx) = handle(1);
        let identity = old_handle.disconnect_requested;
        let sessions = Arc::new(RwLock::new(HashMap::from([("test".into(), replacement)])));
        supervise_worker(sessions.clone(), "test".into(), identity, || {}).await;
        assert!(sessions.read().await.contains_key("test"));
    }
}
