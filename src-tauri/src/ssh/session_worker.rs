use crate::contracts::{
    AppErrorCode, AppErrorDto, SessionStatus, SshClosedPayload, SshClosedReason, SshDataEvent,
    SshErrorPayload, SshStatusPayload,
};
use crate::repositories::recent_session_repository::RecentSessionRepository;
use crate::ssh::client::connect_ssh_session;
use crate::ssh::types::{SessionCommand, SessionWorkerInput};
use crate::utils::{base64::encode_base64, time::now_millis};
use ssh2::ErrorCode;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const MAX_COMMANDS_PER_LOOP: usize = 6;
const MAX_RESIZE_RETRY_ATTEMPTS: usize = 80;
const MAX_TRANSIENT_READ_ERRORS: usize = 250;
const READ_ERROR_KEEPALIVE_INTERVAL: usize = 200;
const COMMAND_BUDGET_MS: u64 = 2;
const SSH_WRITE_CHUNK_SIZE: usize = 256;
const MAX_PENDING_INPUT_BYTES: usize = 4 * 1024 * 1024;

enum WriteStep {
    Complete,
    Pending(Vec<u8>),
    Fatal(AppErrorDto),
}

pub fn run_session_worker(app: AppHandle, mut input: SessionWorkerInput) {
    emit_status(&app, &input, SessionStatus::Connecting, Some("Connecting"));

    let result = run_session_worker_inner(&app, &mut input);
    match result {
        Ok(()) => {}
        Err(error) => {
            crate::app_log!(
                "[ssh-worker][{}] worker exited with error: {} code={:?} details={:?}",
                input.session_id,
                error.message,
                error.code,
                error.details
            );
            update_recent_session(
                &input.recent_repo,
                &input.session_id,
                &recent_status_for_error(&error),
                Some(error.code.clone()),
                Some(&error.message),
            );
            emit_error(&app, &input, error.clone());
            emit_closed(
                &app,
                &input,
                SshClosedReason::WorkerError,
                Some(error.message.clone()),
            );
        }
    }
}

fn run_session_worker_inner(
    app: &AppHandle,
    input: &mut SessionWorkerInput,
) -> Result<(), AppErrorDto> {
    let session = connect_ssh_session(&input.config).map_err(|error| {
        crate::app_log!(
            "[ssh-worker][{}] {} code={:?} details={:?}",
            input.session_id,
            error.message,
            error.code,
            error.details
        );
        error
    })?;

    let mut channel = session.channel_session().map_err(|err| {
        let error = AppErrorDto::with_details(
            AppErrorCode::IoError,
            "Failed to open SSH channel",
            err.to_string(),
            true,
        );
        crate::app_log!(
            "[ssh-worker][{}] {} code={:?} details={:?}",
            input.session_id,
            error.message,
            error.code,
            error.details
        );
        error
    })?;

    channel
        .request_pty(
            "xterm-256color",
            None,
            Some((
                input.config.initial_cols as u32,
                input.config.initial_rows as u32,
                0,
                0,
            )),
        )
        .map_err(|err| {
            let error = AppErrorDto::with_details(
                AppErrorCode::IoError,
                "Failed to request PTY",
                err.to_string(),
                true,
            );
            crate::app_log!(
                "[ssh-worker][{}] {} code={:?} details={:?}",
                input.session_id,
                error.message,
                error.code,
                error.details
            );
            error
        })?;

    channel.shell().map_err(|err| {
        let error = AppErrorDto::with_details(
            AppErrorCode::IoError,
            "Failed to start shell",
            err.to_string(),
            true,
        );
        crate::app_log!(
            "[ssh-worker][{}] {} code={:?} details={:?}",
            input.session_id,
            error.message,
            error.code,
            error.details
        );
        error
    })?;

    session.set_blocking(false);

    record_connected_session(&input.recent_repo, &input.session_id, &input.config.host_id);
    emit_status(app, input, SessionStatus::Connected, Some("Connected"));

    if let Some(command) = input.config.startup_command.clone() {
        write_channel_all(input, &mut channel, command.as_bytes())
            .map_err(|err| AppErrorDto::with_details(AppErrorCode::IoError, "Failed to write startup command", err.to_string(), true))?;
        write_channel_all(input, &mut channel, b"\n")
            .map_err(|err| AppErrorDto::with_details(AppErrorCode::IoError, "Failed to write startup command newline", err.to_string(), true))?;
    }

    let mut buf = [0u8; 32768];
    let idle_wait = Duration::from_millis(20);
    let mut command_rx_closed = false;
    let mut transient_read_errors = 0usize;
    let mut pending_input = VecDeque::<Vec<u8>>::new();
    let mut pending_input_bytes = 0usize;

    loop {
        let mut handled_command = false;
        let command_round_started_at = Instant::now();
        for _ in 0..MAX_COMMANDS_PER_LOOP {
            if command_round_started_at.elapsed() >= Duration::from_millis(COMMAND_BUDGET_MS) {
                break;
            }
            let Ok(command) = input.command_rx.try_recv() else {
                break;
            };

            handled_command = true;
            if handle_command(
                app,
                input,
                &mut channel,
                command,
                &mut pending_input,
                &mut pending_input_bytes,
            )? {
                crate::app_log!(
                    "[ssh-worker][{}] exiting: reason=user_disconnect",
                    input.session_id
                );
                return Ok(());
            }
        }

        if !pending_input.is_empty() {
            process_pending_input_step(
                input,
                &mut channel,
                &mut pending_input,
                &mut pending_input_bytes,
            )?;
        }

        match channel.read(&mut buf) {
            Ok(0) => {
                update_recent_session(
                    &input.recent_repo,
                    &input.session_id,
                    "disconnected",
                    None,
                    Some("Remote closed"),
                );
                emit_status(
                    app,
                    input,
                    SessionStatus::Disconnected,
                    Some("Remote closed"),
                );
                emit_closed(
                    app,
                    input,
                    SshClosedReason::RemoteClosed,
                    Some("Remote closed".to_string()),
                );
                crate::app_log!(
                    "[ssh-worker][{}] exiting: reason=remote_closed",
                    input.session_id
                );
                return Ok(());
            }
            Ok(n) => {
                transient_read_errors = 0;
                let data_base64 = encode_base64(&buf[..n]);
                let _ = input.on_data.send(SshDataEvent::Data {
                    session_id: input.session_id.clone(),
                    data_base64,
                });
            }
            Err(err) if is_transport_read_error(&err) => {
                transient_read_errors += 1;
                if transient_read_errors == 1
                    || transient_read_errors % READ_ERROR_KEEPALIVE_INTERVAL == 0
                {
                    crate::app_log!(
                        "[ssh-worker][{}] transient transport read error {}/{}: {}",
                        input.session_id,
                        transient_read_errors,
                        MAX_TRANSIENT_READ_ERRORS,
                        err
                    );
                }

                if transient_read_errors >= MAX_TRANSIENT_READ_ERRORS {
                    crate::app_log!("[ssh-worker][{}] fatal transport read error: {}", input.session_id, err);
                    update_recent_session(
                        &input.recent_repo,
                        &input.session_id,
                        "failed",
                        Some(AppErrorCode::IoError),
                        Some(&err.to_string()),
                    );
                    let fatal = AppErrorDto::with_details(
                        AppErrorCode::IoError,
                        "Failed to read SSH output",
                        err.to_string(),
                        true,
                    );
                    crate::app_log!(
                        "[ssh-worker][{}] exiting: reason=fatal_transport_read_error",
                        input.session_id
                    );
                    return Err(fatal);
                }

                if transient_read_errors % READ_ERROR_KEEPALIVE_INTERVAL == 0 {
                    let _ = session.keepalive_send();
                }

                if !handled_command {
                    if wait_for_command(
                        app,
                        input,
                        &mut channel,
                        idle_wait,
                        &mut command_rx_closed,
                        &mut pending_input,
                        &mut pending_input_bytes,
                    )? {
                        return Ok(());
                    }
                } else {
                    std::thread::sleep(idle_wait);
                }
            }
            Err(err) if is_retryable_io_error(&err) => {
                transient_read_errors = 0;
                if !handled_command {
                    if wait_for_command(
                        app,
                        input,
                        &mut channel,
                        idle_wait,
                        &mut command_rx_closed,
                        &mut pending_input,
                        &mut pending_input_bytes,
                    )? {
                        crate::app_log!(
                            "[ssh-worker][{}] exiting: reason=user_disconnect",
                            input.session_id
                        );
                        return Ok(());
                    }
                }
            }
            Err(err) => {
                crate::app_log!("[ssh-worker][{}] fatal read error: {}", input.session_id, err);
                update_recent_session(
                    &input.recent_repo,
                    &input.session_id,
                    "failed",
                    Some(AppErrorCode::IoError),
                    Some(&err.to_string()),
                );
                let fatal = AppErrorDto::with_details(
                    AppErrorCode::IoError,
                    "Failed to read SSH output",
                    err.to_string(),
                    true,
                );
                crate::app_log!(
                    "[ssh-worker][{}] exiting: reason=fatal_read_error",
                    input.session_id
                );
                return Err(fatal);
            }
        }
    }
}

fn handle_command(
    app: &AppHandle,
    input: &mut SessionWorkerInput,
    channel: &mut ssh2::Channel,
    command: SessionCommand,
    pending_input: &mut VecDeque<Vec<u8>>,
    pending_input_bytes: &mut usize,
) -> Result<bool, AppErrorDto> {
    match command {
        SessionCommand::Write(data) => {
            enqueue_pending_input(
                input,
                pending_input,
                pending_input_bytes,
                data,
            )?;
        }
        SessionCommand::Resize { cols, rows } => {
            request_pty_size_with_retry(channel, cols, rows, &input.session_id)?;
        }
        SessionCommand::Disconnect => {
            let _ = channel.close();
            update_recent_session(
                &input.recent_repo,
                &input.session_id,
                "disconnected",
                None,
                Some("User disconnected"),
            );
            emit_status(
                app,
                input,
                SessionStatus::Disconnected,
                Some("Disconnected"),
            );
            emit_closed(
                app,
                input,
                SshClosedReason::UserDisconnect,
                Some("User disconnected".to_string()),
            );
            return Ok(true);
        }
    }

    Ok(false)
}

fn wait_for_command(
    app: &AppHandle,
    input: &mut SessionWorkerInput,
    channel: &mut ssh2::Channel,
    idle_wait: Duration,
    command_rx_closed: &mut bool,
    pending_input: &mut VecDeque<Vec<u8>>,
    pending_input_bytes: &mut usize,
) -> Result<bool, AppErrorDto> {
    if *command_rx_closed {
        std::thread::sleep(idle_wait);
        return Ok(false);
    }

    match input.command_rx.recv_timeout(idle_wait) {
        Ok(command) => return handle_command(app, input, channel, command, pending_input, pending_input_bytes),
        Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
            crate::app_log!("[ssh-worker][{}] command channel disconnected", input.session_id);
            *command_rx_closed = true;
            std::thread::sleep(idle_wait);
        }
    }

    Ok(false)
}

fn write_channel_all(
    _input: &SessionWorkerInput,
    channel: &mut ssh2::Channel,
    data: &[u8],
) -> Result<(), std::io::Error> {
    let mut offset = 0usize;
    while offset < data.len() {
        match channel.write(&data[offset..]) {
            Ok(0) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "SSH channel write returned zero bytes",
                ))
            }
            Ok(n) => offset += n,
            Err(err) => return Err(err),
        }
    }
    Ok(())
}

fn drain_channel_output(
    input: &SessionWorkerInput,
    channel: &mut ssh2::Channel,
) -> Result<bool, AppErrorDto> {
    let mut buf = [0u8; 32768];

    loop {
        match channel.read(&mut buf) {
            Ok(0) => return Ok(false),
            Ok(n) => {
                let data_base64 = encode_base64(&buf[..n]);
                let _ = input.on_data.send(SshDataEvent::Data {
                    session_id: input.session_id.clone(),
                    data_base64,
                });
                return Ok(true);
            }
            Err(err) if is_retryable_io_error(&err) || is_transport_read_error(&err) => {
                return Ok(false)
            }
            Err(err) => return Err(AppErrorDto::with_details(
                AppErrorCode::IoError,
                "Failed while draining SSH output",
                err.to_string(),
                true,
            )),
        }
    }
}

fn enqueue_pending_input(
    input: &SessionWorkerInput,
    pending_input: &mut VecDeque<Vec<u8>>,
    pending_input_bytes: &mut usize,
    data: Vec<u8>,
) -> Result<(), AppErrorDto> {
    let next_total = pending_input_bytes.saturating_add(data.len());
    if next_total > MAX_PENDING_INPUT_BYTES {
        crate::app_log!(
            "[ssh-worker][{}] pending input overflow: {} bytes",
            input.session_id,
            next_total
        );
        return Err(AppErrorDto::with_details(
            AppErrorCode::InputBufferFull,
            "SSH write backpressure exceeded",
            format!("pending_input_bytes={next_total}"),
            true,
        ));
    }

    *pending_input_bytes = next_total;
    pending_input.push_back(data);
    Ok(())
}

fn process_pending_input_step(
    input: &SessionWorkerInput,
    channel: &mut ssh2::Channel,
    pending_input: &mut VecDeque<Vec<u8>>,
    pending_input_bytes: &mut usize,
) -> Result<(), AppErrorDto> {
    let Some(mut current) = pending_input.pop_front() else {
        return Ok(());
    };

    let step = write_channel_step(channel, &current);
    match step {
        WriteStep::Complete => {
            *pending_input_bytes = pending_input_bytes.saturating_sub(current.len());
        }
        WriteStep::Pending(remaining) => {
            if remaining.len() < current.len() {
                *pending_input_bytes = pending_input_bytes.saturating_sub(current.len() - remaining.len());
            }
            pending_input.push_front(remaining);
            let _ = drain_channel_output(input, channel)?;
        }
        WriteStep::Fatal(error) => {
            return Err(error);
        }
    }

    current.clear();
    Ok(())
}

fn write_channel_step(channel: &mut ssh2::Channel, data: &[u8]) -> WriteStep {
    if data.is_empty() {
        return WriteStep::Complete;
    }

    let write_len = data.len().min(SSH_WRITE_CHUNK_SIZE);
    match channel.write(&data[..write_len]) {
        Ok(0) => WriteStep::Fatal(AppErrorDto::new(
            AppErrorCode::IoError,
            "SSH channel write returned zero bytes",
            true,
        )),
        Ok(written) => {
            if written >= data.len() {
                WriteStep::Complete
            } else {
                WriteStep::Pending(data[written..].to_vec())
            }
        }
        Err(err) if is_retryable_io_error(&err) || is_transport_read_error(&err) => {
            WriteStep::Pending(data.to_vec())
        }
        Err(err) => WriteStep::Fatal(AppErrorDto::with_details(
            AppErrorCode::IoError,
            "Failed to write SSH input",
            err.to_string(),
            true,
        )),
    }
}

fn request_pty_size_with_retry(
    channel: &mut ssh2::Channel,
    cols: u16,
    rows: u16,
    session_id: &str,
) -> Result<(), AppErrorDto> {
    let mut retry_attempts = 0usize;
    loop {
        match channel.request_pty_size(cols as u32, rows as u32, None, None) {
            Ok(()) => return Ok(()),
            Err(err) if is_retryable_ssh_error(&err) => {
                retry_attempts += 1;
                if retry_attempts >= MAX_RESIZE_RETRY_ATTEMPTS {
                    crate::app_log!(
                        "[ssh-worker][{}] resize backpressure; skipped PTY resize to {}x{}",
                        session_id,
                        cols,
                        rows
                    );
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(5))
            }
            Err(err) => {
                let error = AppErrorDto::with_details(
                    AppErrorCode::IoError,
                    "Failed to resize PTY",
                    err.to_string(),
                    true,
                );
                crate::app_log!(
                    "[ssh-worker][{}] {} code={:?} details={:?}",
                    session_id,
                    error.message,
                    error.code,
                    error.details
                );
                return Err(error);
            }
        }
    }
}

fn is_retryable_ssh_error(err: &ssh2::Error) -> bool {
    matches!(err.code(), ErrorCode::Session(-37) | ErrorCode::Session(-9))
}

fn is_retryable_io_error(err: &std::io::Error) -> bool {
    if matches!(
        err.kind(),
        std::io::ErrorKind::WouldBlock
            | std::io::ErrorKind::TimedOut
            | std::io::ErrorKind::Interrupted
    ) {
        return true;
    }

    let message = err.to_string().to_lowercase();
    message.contains("would block")
        || message.contains("wouldblock")
        || message.contains("eagain")
        || message.contains("resource temporarily unavailable")
        || message.contains("temporarily unavailable")
        || message.contains("operation timed out")
        || message.contains("timed out")
        || message.contains("draining incoming flow")
}

fn is_transport_read_error(err: &std::io::Error) -> bool {
    let message = err.to_string().to_lowercase();
    message.contains("transport read")
}

fn emit_status(
    app: &AppHandle,
    input: &SessionWorkerInput,
    status: SessionStatus,
    message: Option<&str>,
) {
    let payload = SshStatusPayload {
        session_id: input.session_id.clone(),
        host_id: input.config.host_id.clone(),
        status,
        message: message.map(str::to_string),
        at: now_millis(),
    };
    let _ = app.emit("ssh:status", payload);
}

fn emit_error(app: &AppHandle, input: &SessionWorkerInput, error: AppErrorDto) {
    let payload = SshErrorPayload {
        session_id: input.session_id.clone(),
        host_id: Some(input.config.host_id.clone()),
        error,
        at: now_millis(),
    };
    let _ = app.emit("ssh:error", payload);
}

fn emit_closed(
    app: &AppHandle,
    input: &SessionWorkerInput,
    reason: SshClosedReason,
    message: Option<String>,
) {
    let payload = SshClosedPayload {
        session_id: input.session_id.clone(),
        host_id: input.config.host_id.clone(),
        reason,
        message,
        at: now_millis(),
    };
    let _ = app.emit("ssh:closed", payload);
}

fn record_connected_session(repo: &Arc<RecentSessionRepository>, session_id: &str, host_id: &str) {
    let started_at = now_millis();
    let repo = Arc::clone(repo);
    let session_id = session_id.to_string();
    let host_id = host_id.to_string();
    let _ = tauri::async_runtime::block_on(async move {
        repo.record_connected_session(&host_id, &session_id, started_at)
            .await
    });
}

fn update_recent_session(
    repo: &Arc<RecentSessionRepository>,
    session_id: &str,
    status: &str,
    error_code: Option<AppErrorCode>,
    error_message: Option<&str>,
) {
    let repo = Arc::clone(repo);
    let session_id = session_id.to_string();
    let status = status.to_string();
    let message = error_message.map(str::to_string);
    let _ = tauri::async_runtime::block_on(async move {
        repo.mark_session_finished(&session_id, &status, error_code, message.as_deref())
            .await
    });
}

fn recent_status_for_error(error: &AppErrorDto) -> String {
    match error.code {
        AppErrorCode::AuthFailed => "auth_failed".to_string(),
        AppErrorCode::Timeout => "timeout".to_string(),
        AppErrorCode::NetworkUnreachable => "network_error".to_string(),
        _ => "failed".to_string(),
    }
}
