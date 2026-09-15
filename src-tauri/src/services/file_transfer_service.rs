use crate::contracts::{
    AppErrorCode, AppErrorDto, CloseFileTransferSessionInput, DownloadRemotePathInput,
    ListRemoteDirectoryInput, ListRemoteDirectoryResult, OpenFileTransferSessionInput,
    OpenFileTransferSessionResult, RemoteFileEntry, RemoteFileEntryType, SshConnectInput,
    TransferDirection, TransferProgress, TransferStatus, TransferTask,
    UploadRemoteDirectoryFilePayload, UploadRemoteDirectoryInput, UploadRemoteFileInput,
};
use crate::services::host_service::HostService;
use crate::ssh::client::connect_ssh_session;
use crate::ssh::host_key::HostKeyStore;
use crate::utils::{ids::new_id, time::now_millis};
use ssh2::RenameFlags;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFLNK: u32 = 0o120000;
const ROOT_PATH: &str = "/";
const MAX_DIRECTORY_FILE_COUNT: usize = 1000;
const MAX_DIRECTORY_DEPTH: usize = 10;
const MAX_RETAINED_TASKS: usize = 200;
const DIRECTORY_LIMIT_MESSAGE: &str = "文件数量过多请打包后上传或下载";
const TRANSFER_BUFFER_SIZE: usize = 256 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

pub struct FileTransferService {
    scheduler: super::transfer_scheduler::TransferScheduler,
    host_service: Arc<HostService>,
    sessions: Mutex<HashMap<String, Arc<Mutex<FileTransferSession>>>>,
    tasks: Arc<Mutex<HashMap<String, Arc<TransferTaskControl>>>>,
    host_key_store: Arc<HostKeyStore>,
}

struct FileTransferSession {
    host_id: String,
    _session: ssh2::Session,
    sftp: ssh2::Sftp,
}

struct TransferTaskControl {
    snapshot: Mutex<TransferTask>,
    cancelled: AtomicBool,
}

impl TransferTaskControl {
    fn new(snapshot: TransferTask) -> Self {
        Self {
            snapshot: Mutex::new(snapshot),
            cancelled: AtomicBool::new(false),
        }
    }

    fn snapshot(&self) -> Result<TransferTask, AppErrorDto> {
        self.snapshot
            .lock()
            .map(|task| task.clone())
            .map_err(|_| transfer_tasks_lock_error())
    }

    fn mark_running(&self) -> Result<bool, AppErrorDto> {
        let mut task = self
            .snapshot
            .lock()
            .map_err(|_| transfer_tasks_lock_error())?;
        if task.status != TransferStatus::Queued {
            return Ok(false);
        }
        if self.cancelled.load(Ordering::Relaxed) {
            task.status = TransferStatus::Cancelled;
            task.finished_at = Some(now_millis());
            return Ok(false);
        }
        task.status = TransferStatus::Running;
        task.started_at = Some(now_millis());
        Ok(true)
    }

    fn update_progress(
        &self,
        transferred_bytes: u64,
        total_bytes: u64,
        current_file: Option<&str>,
        completed_files: usize,
        total_files: usize,
    ) -> Result<(), AppErrorDto> {
        let mut task = self
            .snapshot
            .lock()
            .map_err(|_| transfer_tasks_lock_error())?;
        task.transferred_bytes = transferred_bytes;
        task.total_bytes = total_bytes;
        task.current_file = current_file.map(ToOwned::to_owned);
        task.completed_files = completed_files;
        task.total_files = total_files;
        Ok(())
    }

    fn finish(&self, result: Result<(), AppErrorDto>) -> Result<(), AppErrorDto> {
        let mut task = self
            .snapshot
            .lock()
            .map_err(|_| transfer_tasks_lock_error())?;
        task.finished_at = Some(now_millis());
        task.current_file = None;
        match result {
            Ok(()) => {
                // A cancellation racing with an already committed transfer cannot undo it. In
                // that case completion is the truthful terminal state.
                task.status = TransferStatus::Completed;
                task.transferred_bytes = task.total_bytes.max(task.transferred_bytes);
                task.completed_files = task.total_files;
                task.error = None;
            }
            Err(_) if self.cancelled.load(Ordering::Relaxed) => {
                task.status = TransferStatus::Cancelled;
                task.error = None;
            }
            Err(error) => {
                task.status = TransferStatus::Failed;
                task.error = Some(error);
            }
        }
        Ok(())
    }

    fn request_cancel(&self) -> Result<(), AppErrorDto> {
        self.cancelled.store(true, Ordering::Relaxed);
        let mut task = self
            .snapshot
            .lock()
            .map_err(|_| transfer_tasks_lock_error())?;
        if task.status == TransferStatus::Queued {
            task.status = TransferStatus::Cancelled;
            task.finished_at = Some(now_millis());
        }
        Ok(())
    }
}

struct ProgressReporter {
    task: Arc<TransferTaskControl>,
    channel: Channel<TransferProgress>,
}

impl ProgressReporter {
    fn report(
        &self,
        transferred_bytes: u64,
        total_bytes: u64,
        current_file: Option<&str>,
        completed_files: usize,
        total_files: usize,
    ) -> Result<(), AppErrorDto> {
        self.task.update_progress(
            transferred_bytes,
            total_bytes,
            current_file,
            completed_files,
            total_files,
        )?;
        self.emit_snapshot()
    }

    fn emit_snapshot(&self) -> Result<(), AppErrorDto> {
        let task = self.task.snapshot()?;
        let _ = self.channel.send(TransferProgress {
            transfer_id: task.transfer_id,
            status: task.status,
            transferred_bytes: task.transferred_bytes,
            total_bytes: task.total_bytes,
            current_file: task.current_file,
            completed_files: task.completed_files,
            total_files: task.total_files,
        });
        Ok(())
    }
}

impl FileTransferService {
    pub fn new(
        host_service: Arc<HostService>,
        host_key_store: Arc<HostKeyStore>,
    ) -> std::io::Result<Self> {
        let tasks = Arc::new(Mutex::new(HashMap::new()));
        let weak_tasks = Arc::downgrade(&tasks);
        std::thread::Builder::new()
            .name("transfer-history-cleanup".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let Some(tasks) = weak_tasks.upgrade() else {
                    break;
                };
                if let Ok(mut tasks) = tasks.lock() {
                    prune_transfer_tasks(&mut tasks, now_millis());
                };
            })?;
        Ok(Self {
            scheduler: super::transfer_scheduler::TransferScheduler::new(4)?,
            host_service,
            sessions: Mutex::new(HashMap::new()),
            tasks,
            host_key_store,
        })
    }

    pub async fn open_file_transfer_session(
        &self,
        input: OpenFileTransferSessionInput,
    ) -> Result<OpenFileTransferSessionResult, AppErrorDto> {
        let config = self
            .host_service
            .build_connect_config_with_credentials(SshConnectInput {
                host_id: input.host_id,
                initial_cols: 0,
                initial_rows: 0,
                username: input.username,
                auth_type: input.auth_type,
                password: input.password,
                private_key_path: input.private_key_path,
                private_key_passphrase: input.private_key_passphrase,
            })
            .await?;
        let session = connect_ssh_session(&config, &self.host_key_store)?;
        let sftp = session.sftp().map_err(|error| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                "Failed to open SFTP session",
                error.to_string(),
                true,
            )
        })?;
        let transfer_session_id = new_id();
        self.sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?
            .insert(
                transfer_session_id.clone(),
                Arc::new(Mutex::new(FileTransferSession {
                    host_id: config.host_id,
                    _session: session,
                    sftp,
                })),
            );
        Ok(OpenFileTransferSessionResult {
            transfer_session_id,
        })
    }

    pub async fn close_file_transfer_session(
        &self,
        input: CloseFileTransferSessionInput,
    ) -> Result<(), AppErrorDto> {
        // Background tasks clone the per-session Arc before enqueueing. Removing the lookup entry
        // prevents new work while allowing already queued/running tasks to own the connection.
        self.sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?
            .remove(&input.transfer_session_id);
        Ok(())
    }

    pub async fn list_remote_directory(
        &self,
        input: ListRemoteDirectoryInput,
    ) -> Result<ListRemoteDirectoryResult, AppErrorDto> {
        let transfer_session = self.get_session(&input.transfer_session_id)?;
        let transfer_session = transfer_session.try_lock().map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => AppErrorDto::new(
                AppErrorCode::IoError,
                "当前会话正在传输文件，请稍后刷新目录",
                true,
            ),
            std::sync::TryLockError::Poisoned(_) => file_transfer_sessions_lock_error(),
        })?;
        let sftp = &transfer_session.sftp;
        let (path, fallback_to_root) = resolve_remote_directory_path(sftp, input.path.as_deref());
        let entries = sftp.readdir(Path::new(&path)).map_err(|error| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to read remote directory {path}"),
                error.to_string(),
                true,
            )
        })?;
        let mut items = entries
            .into_iter()
            .filter_map(|(entry_path, stat)| to_remote_file_entry(&path, entry_path, stat))
            .collect::<Vec<_>>();
        items.sort_by(|left, right| match (&left.entry_type, &right.entry_type) {
            (RemoteFileEntryType::Directory, RemoteFileEntryType::Directory)
            | (RemoteFileEntryType::File, RemoteFileEntryType::File)
            | (RemoteFileEntryType::Symlink, RemoteFileEntryType::Symlink)
            | (RemoteFileEntryType::Other, RemoteFileEntryType::Other) => {
                left.name.to_lowercase().cmp(&right.name.to_lowercase())
            }
            (RemoteFileEntryType::Directory, _) => std::cmp::Ordering::Less,
            (_, RemoteFileEntryType::Directory) => std::cmp::Ordering::Greater,
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        });
        Ok(ListRemoteDirectoryResult {
            host_id: transfer_session.host_id.clone(),
            path,
            entries: items,
            fallback_to_root,
        })
    }

    pub fn enqueue_upload_remote_file(
        self: &Arc<Self>,
        input: UploadRemoteFileInput,
        on_progress: Channel<TransferProgress>,
    ) -> Result<TransferTask, AppErrorDto> {
        validate_transfer_id(&input.transfer_id)?;
        validate_remote_entry_name(&input.file_name, "File name")?;
        let session = self.get_session(&input.transfer_session_id)?;
        let total_bytes = std::fs::metadata(&input.local_file_path)
            .map_err(AppErrorDto::io)?
            .len();
        let remote_path = join_remote_path(
            &normalize_remote_path(&input.remote_dir_path),
            &input.file_name,
        );
        let task = new_transfer_task(
            &input.transfer_id,
            &input.transfer_session_id,
            TransferDirection::Upload,
            input.local_file_path.clone(),
            remote_path,
            total_bytes,
            1,
        );
        let control = self.register_task(task)?;
        self.spawn_task(
            control.clone(),
            session,
            on_progress,
            move |session, cancel, reporter| upload_file(session, &input, cancel, reporter),
        )?;
        control.snapshot()
    }

    pub fn enqueue_upload_remote_directory(
        self: &Arc<Self>,
        input: UploadRemoteDirectoryInput,
        on_progress: Channel<TransferProgress>,
    ) -> Result<TransferTask, AppErrorDto> {
        validate_transfer_id(&input.transfer_id)?;
        validate_directory_payload(&input.directory_name, &input.directories, &input.files)?;
        let session = self.get_session(&input.transfer_session_id)?;
        let total_bytes = input.files.iter().try_fold(0u64, |total, file| {
            std::fs::metadata(&file.local_file_path)
                .map(|metadata| total.saturating_add(metadata.len()))
                .map_err(AppErrorDto::io)
        })?;
        let remote_path = join_remote_path(
            &normalize_remote_path(&input.remote_dir_path),
            &input.directory_name,
        );
        let task = new_transfer_task(
            &input.transfer_id,
            &input.transfer_session_id,
            TransferDirection::Upload,
            input.directory_name.clone(),
            remote_path,
            total_bytes,
            input.files.len(),
        );
        let control = self.register_task(task)?;
        self.spawn_task(
            control.clone(),
            session,
            on_progress,
            move |session, cancel, reporter| upload_directory(session, input, cancel, reporter),
        )?;
        control.snapshot()
    }

    pub fn enqueue_download_remote_path(
        self: &Arc<Self>,
        input: DownloadRemotePathInput,
        on_progress: Channel<TransferProgress>,
    ) -> Result<TransferTask, AppErrorDto> {
        validate_transfer_id(&input.transfer_id)?;
        let session = self.get_session(&input.transfer_session_id)?;
        if input.local_path.trim().is_empty() {
            return Err(AppErrorDto::new(
                AppErrorCode::IoError,
                "Local destination path is required",
                false,
            ));
        }
        let task = new_transfer_task(
            &input.transfer_id,
            &input.transfer_session_id,
            TransferDirection::Download,
            normalize_remote_path(&input.remote_path),
            input.local_path.clone(),
            0,
            0,
        );
        let control = self.register_task(task)?;
        self.spawn_task(
            control.clone(),
            session,
            on_progress,
            move |session, cancel, reporter| download_path(session, &input, cancel, reporter),
        )?;
        control.snapshot()
    }

    pub fn list_transfer_tasks(&self) -> Result<Vec<TransferTask>, AppErrorDto> {
        let controls = self
            .tasks
            .lock()
            .map_err(|_| transfer_tasks_lock_error())?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut tasks = controls
            .into_iter()
            .map(|control| control.snapshot())
            .collect::<Result<Vec<_>, _>>()?;
        tasks.sort_by_key(|task| Reverse(task.created_at));
        Ok(tasks)
    }

    pub fn get_transfer_task(&self, transfer_id: &str) -> Result<TransferTask, AppErrorDto> {
        self.get_task_control(transfer_id)?.snapshot()
    }

    pub fn cancel_transfer(&self, transfer_id: &str) -> Result<TransferTask, AppErrorDto> {
        let task = self.get_task_control(transfer_id)?;
        task.request_cancel()?;
        task.snapshot()
    }

    pub fn delete_transfer_task(&self, transfer_id: &str) -> Result<(), AppErrorDto> {
        let mut tasks = self.tasks.lock().map_err(|_| transfer_tasks_lock_error())?;
        delete_transfer_record(&mut tasks, transfer_id)
    }

    fn register_task(&self, task: TransferTask) -> Result<Arc<TransferTaskControl>, AppErrorDto> {
        let mut tasks = self.tasks.lock().map_err(|_| transfer_tasks_lock_error())?;
        if tasks.contains_key(&task.transfer_id) {
            return Err(AppErrorDto::new(
                AppErrorCode::HostInvalid,
                "Transfer ID is already in use",
                false,
            ));
        }
        prune_transfer_tasks(&mut tasks, now_millis());
        ensure_transfer_task_capacity(tasks.len())?;
        let transfer_id = task.transfer_id.clone();
        let control = Arc::new(TransferTaskControl::new(task));
        tasks.insert(transfer_id, control.clone());
        Ok(control)
    }

    fn spawn_task<F>(
        &self,
        task: Arc<TransferTaskControl>,
        session: Arc<Mutex<FileTransferSession>>,
        channel: Channel<TransferProgress>,
        operation: F,
    ) -> Result<(), AppErrorDto>
    where
        F: FnOnce(&FileTransferSession, &AtomicBool, &ProgressReporter) -> Result<(), AppErrorDto>
            + Send
            + 'static,
    {
        let reporter = ProgressReporter {
            task: task.clone(),
            channel,
        };
        let session_id = task.snapshot()?.transfer_session_id;
        let worker_task = task.clone();
        let submitted = self.scheduler.submit(session_id, move || {
            if worker_task.cancelled.load(Ordering::Relaxed) {
                let _ = reporter.emit_snapshot();
                return;
            }
            let session = match session.lock() {
                Ok(session) => session,
                Err(_) => {
                    let _ = worker_task.finish(Err(file_transfer_sessions_lock_error()));
                    let _ = reporter.emit_snapshot();
                    return;
                }
            };
            match worker_task.mark_running() {
                Ok(true) => {}
                Ok(false) => {
                    let _ = reporter.emit_snapshot();
                    return;
                }
                Err(error) => {
                    let _ = worker_task.finish(Err(error));
                    let _ = reporter.emit_snapshot();
                    return;
                }
            }
            let _ = reporter.emit_snapshot();
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                operation(&session, &worker_task.cancelled, &reporter)
            }))
            .unwrap_or_else(|_| {
                Err(AppErrorDto::new(
                    AppErrorCode::Unknown,
                    "File transfer worker panicked",
                    false,
                ))
            });
            let _ = worker_task.finish(result);
            let _ = reporter.emit_snapshot();
        });
        submitted.map_err(|error| {
            let error = AppErrorDto::io(error);
            let _ = task.finish(Err(error.clone()));
            error
        })
    }

    fn get_session(
        &self,
        transfer_session_id: &str,
    ) -> Result<Arc<Mutex<FileTransferSession>>, AppErrorDto> {
        self.sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?
            .get(transfer_session_id)
            .cloned()
            .ok_or_else(AppErrorDto::session_not_found)
    }

    fn get_task_control(&self, transfer_id: &str) -> Result<Arc<TransferTaskControl>, AppErrorDto> {
        self.tasks
            .lock()
            .map_err(|_| transfer_tasks_lock_error())?
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| {
                AppErrorDto::new(
                    AppErrorCode::SessionNotFound,
                    "Transfer task not found",
                    false,
                )
            })
    }
}

fn new_transfer_task(
    transfer_id: &str,
    transfer_session_id: &str,
    direction: TransferDirection,
    source_path: String,
    destination_path: String,
    total_bytes: u64,
    total_files: usize,
) -> TransferTask {
    TransferTask {
        transfer_id: transfer_id.to_string(),
        transfer_session_id: transfer_session_id.to_string(),
        direction,
        status: TransferStatus::Queued,
        source_path,
        destination_path,
        transferred_bytes: 0,
        total_bytes,
        current_file: None,
        completed_files: 0,
        total_files,
        error: None,
        created_at: now_millis(),
        started_at: None,
        finished_at: None,
    }
}

fn validate_transfer_id(transfer_id: &str) -> Result<(), AppErrorDto> {
    if transfer_id.trim().is_empty() {
        Err(AppErrorDto::new(
            AppErrorCode::HostInvalid,
            "Transfer ID is required",
            false,
        ))
    } else {
        Ok(())
    }
}

fn prune_transfer_tasks(tasks: &mut HashMap<String, Arc<TransferTaskControl>>, now: i64) {
    tasks.retain(|_, control| {
        !control.snapshot().is_ok_and(|task| {
            task.status == TransferStatus::Completed
                && task
                    .finished_at
                    .is_some_and(|finished| now.saturating_sub(finished) >= 60_000)
        })
    });
}

fn delete_transfer_record(
    tasks: &mut HashMap<String, Arc<TransferTaskControl>>,
    transfer_id: &str,
) -> Result<(), AppErrorDto> {
    if let Some(control) = tasks.get(transfer_id) {
        if matches!(
            control.snapshot()?.status,
            TransferStatus::Queued | TransferStatus::Running
        ) {
            return Err(AppErrorDto::new(
                AppErrorCode::Unsupported,
                "请先取消正在进行的传输",
                false,
            ));
        }
    }
    tasks.remove(transfer_id);
    Ok(())
}

fn ensure_transfer_task_capacity(task_count: usize) -> Result<(), AppErrorDto> {
    if task_count >= MAX_RETAINED_TASKS {
        Err(AppErrorDto::new(
            AppErrorCode::Unsupported,
            "后台传输记录过多，请删除已结束的记录或等待成功记录自动清理后重试",
            true,
        ))
    } else {
        Ok(())
    }
}

fn upload_file(
    session: &FileTransferSession,
    input: &UploadRemoteFileInput,
    cancel: &AtomicBool,
    reporter: &ProgressReporter,
) -> Result<(), AppErrorDto> {
    check_cancelled(cancel)?;
    let sftp = &session.sftp;
    let remote_path = join_remote_path(
        &normalize_remote_path(&input.remote_dir_path),
        &input.file_name,
    );
    let temporary_path = remote_temporary_path(&remote_path);
    let mut local_file = std::fs::File::open(&input.local_file_path).map_err(|error| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            format!("Failed to open local file {}", input.local_file_path),
            error.to_string(),
            true,
        )
    })?;
    let total_bytes = local_file.metadata().map_err(AppErrorDto::io)?.len();
    let result = (|| {
        let mut remote_file = sftp.create(Path::new(&temporary_path)).map_err(|error| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to create remote file {temporary_path}"),
                error.to_string(),
                true,
            )
        })?;
        copy_stream_with_progress(
            &mut local_file,
            &mut remote_file,
            cancel,
            reporter,
            total_bytes,
            &input.file_name,
            0,
            1,
            0,
        )?;
        remote_file.flush().map_err(AppErrorDto::io)?;
        drop(remote_file);
        check_cancelled(cancel)?;
        commit_remote_file(sftp, &temporary_path, &remote_path)
    })();
    if result.is_err() {
        let _ = sftp.unlink(Path::new(&temporary_path));
    }
    result
}

fn upload_directory(
    session: &FileTransferSession,
    mut input: UploadRemoteDirectoryInput,
    cancel: &AtomicBool,
    reporter: &ProgressReporter,
) -> Result<(), AppErrorDto> {
    let sftp = &session.sftp;
    let remote_dir = normalize_remote_path(&input.remote_dir_path);
    let remote_target = join_remote_path(&remote_dir, &input.directory_name);
    if sftp.stat(Path::new(&remote_target)).is_ok() {
        return Err(AppErrorDto::new(
            AppErrorCode::IoError,
            format!("Remote destination already exists: {remote_target}"),
            false,
        ));
    }
    let remote_staging = remote_temporary_path(&remote_target);
    let total_bytes = input.files.iter().try_fold(0u64, |total, file| {
        std::fs::metadata(&file.local_file_path)
            .map(|metadata| total.saturating_add(metadata.len()))
            .map_err(AppErrorDto::io)
    })?;
    let total_files = input.files.len();
    let result = (|| {
        ensure_remote_directory(sftp, &remote_staging)?;
        input.directories.sort_by_key(|path| relative_depth(path));
        for directory in input.directories {
            check_cancelled(cancel)?;
            ensure_remote_directory(sftp, &join_remote_path(&remote_staging, &directory))?;
        }
        let mut transferred_bytes = 0u64;
        for (index, file) in input.files.into_iter().enumerate() {
            check_cancelled(cancel)?;
            let remote_file_path = join_remote_path(&remote_staging, &file.relative_path);
            if let Some(parent) = remote_parent_path(&remote_file_path) {
                ensure_remote_directory(sftp, &parent)?;
            }
            let mut local_file = std::fs::File::open(&file.local_file_path).map_err(|error| {
                AppErrorDto::with_details(
                    AppErrorCode::IoError,
                    format!("Failed to open local file {}", file.local_file_path),
                    error.to_string(),
                    true,
                )
            })?;
            let mut remote_file = sftp.create(Path::new(&remote_file_path)).map_err(|error| {
                AppErrorDto::with_details(
                    AppErrorCode::IoError,
                    format!("Failed to create remote file {remote_file_path}"),
                    error.to_string(),
                    true,
                )
            })?;
            transferred_bytes = copy_stream_with_progress(
                &mut local_file,
                &mut remote_file,
                cancel,
                reporter,
                total_bytes,
                &file.relative_path,
                index,
                total_files,
                transferred_bytes,
            )?;
            remote_file.flush().map_err(AppErrorDto::io)?;
        }
        check_cancelled(cancel)?;
        sftp.rename(Path::new(&remote_staging), Path::new(&remote_target), None)
            .map_err(|error| {
                AppErrorDto::with_details(
                    AppErrorCode::IoError,
                    format!("Failed to finish directory upload {remote_target}"),
                    error.to_string(),
                    true,
                )
            })
    })();
    if result.is_err() {
        let _ = remove_remote_tree(sftp, &remote_staging, 0);
    }
    result
}

fn download_path(
    session: &FileTransferSession,
    input: &DownloadRemotePathInput,
    cancel: &AtomicBool,
    reporter: &ProgressReporter,
) -> Result<(), AppErrorDto> {
    check_cancelled(cancel)?;
    let sftp = &session.sftp;
    let remote_path = normalize_remote_path(&input.remote_path);
    let local_target = PathBuf::from(&input.local_path);
    let stat = sftp.stat(Path::new(&remote_path)).map_err(|error| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            format!("Failed to stat remote path {remote_path}"),
            error.to_string(),
            true,
        )
    })?;
    let entry_type = detect_remote_entry_type(sftp, &remote_path, &stat);
    let staging = local_temporary_path(&local_target, "part")?;
    let result = match entry_type {
        RemoteFileEntryType::File => {
            let total_bytes = stat.size.unwrap_or(0);
            reporter.report(
                0,
                total_bytes,
                remote_file_name(&remote_path).as_deref(),
                0,
                1,
            )?;
            (|| {
                if let Some(parent) = staging.parent() {
                    std::fs::create_dir_all(parent).map_err(AppErrorDto::io)?;
                }
                let mut remote_file = sftp.open(Path::new(&remote_path)).map_err(|error| {
                    AppErrorDto::with_details(
                        AppErrorCode::IoError,
                        format!("Failed to open remote file {remote_path}"),
                        error.to_string(),
                        true,
                    )
                })?;
                let mut local_file = std::fs::File::create(&staging).map_err(AppErrorDto::io)?;
                copy_stream_with_progress(
                    &mut remote_file,
                    &mut local_file,
                    cancel,
                    reporter,
                    total_bytes,
                    remote_file_name(&remote_path)
                        .as_deref()
                        .unwrap_or(&remote_path),
                    0,
                    1,
                    0,
                )?;
                local_file.flush().map_err(AppErrorDto::io)?;
                drop(local_file);
                check_cancelled(cancel)?;
                commit_local_path(&staging, &local_target)
            })()
        }
        RemoteFileEntryType::Directory => {
            let mut manifest = DownloadManifest::default();
            scan_remote_directory(sftp, &remote_path, Path::new(""), 0, cancel, &mut manifest)?;
            reporter.report(0, manifest.total_bytes, None, 0, manifest.files.len())?;
            (|| {
                std::fs::create_dir_all(&staging).map_err(AppErrorDto::io)?;
                for directory in &manifest.directories {
                    check_cancelled(cancel)?;
                    std::fs::create_dir_all(staging.join(directory)).map_err(AppErrorDto::io)?;
                }
                let mut transferred_bytes = 0u64;
                for (index, file) in manifest.files.iter().enumerate() {
                    check_cancelled(cancel)?;
                    let local_path = staging.join(&file.relative_path);
                    if let Some(parent) = local_path.parent() {
                        std::fs::create_dir_all(parent).map_err(AppErrorDto::io)?;
                    }
                    let mut remote_file =
                        sftp.open(Path::new(&file.remote_path)).map_err(|error| {
                            AppErrorDto::with_details(
                                AppErrorCode::IoError,
                                format!("Failed to open remote file {}", file.remote_path),
                                error.to_string(),
                                true,
                            )
                        })?;
                    let mut local_file =
                        std::fs::File::create(&local_path).map_err(AppErrorDto::io)?;
                    transferred_bytes = copy_stream_with_progress(
                        &mut remote_file,
                        &mut local_file,
                        cancel,
                        reporter,
                        manifest.total_bytes,
                        &file.relative_path.to_string_lossy(),
                        index,
                        manifest.files.len(),
                        transferred_bytes,
                    )?;
                    local_file.flush().map_err(AppErrorDto::io)?;
                }
                check_cancelled(cancel)?;
                commit_local_path(&staging, &local_target)
            })()
        }
        RemoteFileEntryType::Symlink | RemoteFileEntryType::Other => Err(AppErrorDto::new(
            AppErrorCode::Unsupported,
            "Only regular files and directories can be downloaded",
            false,
        )),
    };
    if result.is_err() {
        let _ = remove_local_path(&staging);
    }
    result
}

#[derive(Default)]
struct DownloadManifest {
    directories: Vec<PathBuf>,
    files: Vec<DownloadManifestFile>,
    total_bytes: u64,
}

struct DownloadManifestFile {
    remote_path: String,
    relative_path: PathBuf,
}

fn scan_remote_directory(
    sftp: &ssh2::Sftp,
    remote_dir: &str,
    relative_dir: &Path,
    depth: usize,
    cancel: &AtomicBool,
    manifest: &mut DownloadManifest,
) -> Result<(), AppErrorDto> {
    check_cancelled(cancel)?;
    if depth > MAX_DIRECTORY_DEPTH {
        return Err(directory_limit_error());
    }
    let entries = sftp.readdir(Path::new(remote_dir)).map_err(|error| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            format!("Failed to read remote directory {remote_dir}"),
            error.to_string(),
            true,
        )
    })?;
    for (entry_path, stat) in entries {
        check_cancelled(cancel)?;
        let Some(name) = entry_path.file_name() else {
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }
        let name = name.to_string_lossy().to_string();
        let remote_path = join_remote_path(remote_dir, &name);
        let relative_path = relative_dir.join(&name);
        match detect_remote_entry_type(sftp, &remote_path, &stat) {
            RemoteFileEntryType::Directory => {
                manifest.directories.push(relative_path.clone());
                scan_remote_directory(
                    sftp,
                    &remote_path,
                    &relative_path,
                    depth + 1,
                    cancel,
                    manifest,
                )?;
            }
            RemoteFileEntryType::File => {
                if manifest.files.len() >= MAX_DIRECTORY_FILE_COUNT {
                    return Err(directory_limit_error());
                }
                manifest.total_bytes = manifest.total_bytes.saturating_add(stat.size.unwrap_or(0));
                manifest.files.push(DownloadManifestFile {
                    remote_path,
                    relative_path,
                });
            }
            RemoteFileEntryType::Symlink | RemoteFileEntryType::Other => {}
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn copy_stream_with_progress<R: Read, W: Write>(
    source: &mut R,
    destination: &mut W,
    cancel: &AtomicBool,
    reporter: &ProgressReporter,
    total_bytes: u64,
    current_file: &str,
    completed_files: usize,
    total_files: usize,
    initial_transferred_bytes: u64,
) -> Result<u64, AppErrorDto> {
    let mut buffer = vec![0u8; TRANSFER_BUFFER_SIZE];
    let mut transferred_bytes = initial_transferred_bytes;
    let mut last_report = Instant::now() - PROGRESS_INTERVAL;
    reporter.report(
        transferred_bytes,
        total_bytes,
        Some(current_file),
        completed_files,
        total_files,
    )?;
    loop {
        check_cancelled(cancel)?;
        let count = source.read(&mut buffer).map_err(AppErrorDto::io)?;
        if count == 0 {
            break;
        }
        destination
            .write_all(&buffer[..count])
            .map_err(AppErrorDto::io)?;
        transferred_bytes = transferred_bytes.saturating_add(count as u64);
        if last_report.elapsed() >= PROGRESS_INTERVAL {
            reporter.report(
                transferred_bytes,
                total_bytes,
                Some(current_file),
                completed_files,
                total_files,
            )?;
            last_report = Instant::now();
        }
    }
    reporter.report(
        transferred_bytes,
        total_bytes,
        Some(current_file),
        completed_files + 1,
        total_files,
    )?;
    Ok(transferred_bytes)
}

fn check_cancelled(cancel: &AtomicBool) -> Result<(), AppErrorDto> {
    if cancel.load(Ordering::Relaxed) {
        Err(AppErrorDto::new(AppErrorCode::IoError, "传输已取消", false))
    } else {
        Ok(())
    }
}

fn commit_remote_file(
    sftp: &ssh2::Sftp,
    temporary_path: &str,
    target_path: &str,
) -> Result<(), AppErrorDto> {
    sftp.rename(
        Path::new(temporary_path),
        Path::new(target_path),
        Some(RenameFlags::OVERWRITE | RenameFlags::ATOMIC),
    )
    .or_else(|_| {
        sftp.rename(
            Path::new(temporary_path),
            Path::new(target_path),
            Some(RenameFlags::OVERWRITE),
        )
    })
    .map_err(|error| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            format!("Failed to finish upload {target_path}"),
            error.to_string(),
            true,
        )
    })
}

fn commit_local_path(temporary_path: &Path, target_path: &Path) -> Result<(), AppErrorDto> {
    if !target_path.exists() {
        return std::fs::rename(temporary_path, target_path).map_err(AppErrorDto::io);
    }
    let backup_path = local_temporary_path(target_path, "backup")?;
    std::fs::rename(target_path, &backup_path).map_err(AppErrorDto::io)?;
    match std::fs::rename(temporary_path, target_path) {
        Ok(()) => {
            let _ = remove_local_path(&backup_path);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::rename(&backup_path, target_path);
            Err(AppErrorDto::io(error))
        }
    }
}

fn local_temporary_path(target_path: &Path, suffix: &str) -> Result<PathBuf, AppErrorDto> {
    let file_name = target_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            AppErrorDto::new(AppErrorCode::IoError, "Local destination is invalid", false)
        })?;
    Ok(target_path.with_file_name(format!(".{file_name}.wmcssh-{}.{suffix}", new_id())))
}

fn remote_temporary_path(target_path: &str) -> String {
    let parent = remote_parent_path(target_path).unwrap_or_else(|| ROOT_PATH.to_string());
    let name = remote_file_name(target_path).unwrap_or_else(|| "transfer".to_string());
    join_remote_path(&parent, &format!(".{name}.wmcssh-{}.part", new_id()))
}

fn remove_local_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else if path.exists() {
        std::fs::remove_file(path)
    } else {
        Ok(())
    }
}

fn remove_remote_tree(sftp: &ssh2::Sftp, path: &str, depth: usize) -> Result<(), AppErrorDto> {
    if depth > MAX_DIRECTORY_DEPTH + 1 {
        return Err(directory_limit_error());
    }
    let entries = match sftp.readdir(Path::new(path)) {
        Ok(entries) => entries,
        Err(_) => {
            let _ = sftp.unlink(Path::new(path));
            return Ok(());
        }
    };
    for (entry_path, stat) in entries {
        let Some(name) = entry_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
        else {
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }
        let child = join_remote_path(path, &name);
        if detect_remote_entry_type(sftp, &child, &stat) == RemoteFileEntryType::Directory {
            remove_remote_tree(sftp, &child, depth + 1)?;
        } else {
            let _ = sftp.unlink(Path::new(&child));
        }
    }
    let _ = sftp.rmdir(Path::new(path));
    Ok(())
}

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == ROOT_PATH {
        ROOT_PATH.to_string()
    } else {
        trimmed.trim_end_matches('/').to_string()
    }
}

fn resolve_remote_directory_path(sftp: &ssh2::Sftp, path: Option<&str>) -> (String, bool) {
    match path {
        Some(path) if !path.trim().is_empty() => (normalize_remote_path(path), false),
        _ => match sftp.realpath(Path::new(".")) {
            Ok(path) => {
                let normalized = normalize_remote_path(&path.to_string_lossy());
                let fallback_to_root = normalized == ROOT_PATH;
                (normalized, fallback_to_root)
            }
            Err(_) => (ROOT_PATH.to_string(), true),
        },
    }
}

fn to_remote_file_entry(
    parent_path: &str,
    entry_path: PathBuf,
    stat: ssh2::FileStat,
) -> Option<RemoteFileEntry> {
    let name = entry_path.file_name()?.to_string_lossy().to_string();
    if name == "." || name == ".." {
        return None;
    }
    Some(RemoteFileEntry {
        path: join_remote_path(parent_path, &name),
        name,
        entry_type: detect_entry_type(&stat),
        size: stat.size,
        modified_at: stat.mtime.map(|mtime| (mtime as i64) * 1000),
    })
}

fn detect_entry_type(stat: &ssh2::FileStat) -> RemoteFileEntryType {
    match stat.perm.map(|perm| perm & S_IFMT) {
        Some(S_IFDIR) => RemoteFileEntryType::Directory,
        Some(S_IFLNK) => RemoteFileEntryType::Symlink,
        Some(0) | None => RemoteFileEntryType::Other,
        _ => RemoteFileEntryType::File,
    }
}

fn detect_remote_entry_type(
    sftp: &ssh2::Sftp,
    remote_path: &str,
    stat: &ssh2::FileStat,
) -> RemoteFileEntryType {
    let entry_type = detect_entry_type(stat);
    if entry_type != RemoteFileEntryType::Other {
        return entry_type;
    }
    if sftp.readdir(Path::new(remote_path)).is_ok() {
        return RemoteFileEntryType::Directory;
    }
    if sftp.open(Path::new(remote_path)).is_ok() {
        return RemoteFileEntryType::File;
    }
    RemoteFileEntryType::Other
}

fn join_remote_path(parent_path: &str, name: &str) -> String {
    if parent_path == ROOT_PATH {
        format!("/{name}")
    } else {
        format!("{parent_path}/{name}")
    }
}

fn ensure_remote_directory(sftp: &ssh2::Sftp, path: &str) -> Result<(), AppErrorDto> {
    match sftp.stat(Path::new(path)) {
        Ok(stat)
            if detect_remote_entry_type(sftp, path, &stat) == RemoteFileEntryType::Directory =>
        {
            Ok(())
        }
        Ok(_) => Err(AppErrorDto::new(
            AppErrorCode::IoError,
            format!("Remote path exists and is not a directory: {path}"),
            false,
        )),
        Err(_) => sftp.mkdir(Path::new(path), 0o755).map_err(|error| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to create remote directory {path}"),
                error.to_string(),
                true,
            )
        }),
    }
}

fn validate_directory_payload(
    directory_name: &str,
    directories: &[String],
    files: &[UploadRemoteDirectoryFilePayload],
) -> Result<(), AppErrorDto> {
    validate_remote_entry_name(directory_name, "Directory name")?;
    if files.len() > MAX_DIRECTORY_FILE_COUNT {
        return Err(directory_limit_error());
    }
    for path in directories
        .iter()
        .map(String::as_str)
        .chain(files.iter().map(|file| file.relative_path.as_str()))
    {
        validate_relative_path(path)?;
        if relative_depth(path) > MAX_DIRECTORY_DEPTH {
            return Err(directory_limit_error());
        }
    }
    Ok(())
}

fn validate_remote_entry_name(name: &str, label: &str) -> Result<(), AppErrorDto> {
    if name.trim().is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == "."
        || name == ".."
    {
        return Err(AppErrorDto::new(
            AppErrorCode::IoError,
            format!("{label} is invalid"),
            false,
        ));
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> Result<(), AppErrorDto> {
    if path.trim().is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.split('/').any(|part| part == ".." || part.is_empty())
    {
        return Err(AppErrorDto::new(
            AppErrorCode::IoError,
            "Directory entry path is invalid",
            false,
        ));
    }
    Ok(())
}

fn relative_depth(path: &str) -> usize {
    path.split('/').filter(|part| !part.is_empty()).count()
}

fn remote_parent_path(path: &str) -> Option<String> {
    let index = path.rfind('/')?;
    if index == 0 {
        Some(ROOT_PATH.to_string())
    } else {
        Some(path[..index].to_string())
    }
}

fn remote_file_name(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
}

fn directory_limit_error() -> AppErrorDto {
    AppErrorDto::new(AppErrorCode::Unsupported, DIRECTORY_LIMIT_MESSAGE, false)
}

fn file_transfer_sessions_lock_error() -> AppErrorDto {
    AppErrorDto::new(
        AppErrorCode::Unknown,
        "File transfer session state is unavailable",
        true,
    )
}

fn transfer_tasks_lock_error() -> AppErrorDto {
    AppErrorDto::new(
        AppErrorCode::Unknown,
        "File transfer task state is unavailable",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_task() -> TransferTask {
        new_transfer_task(
            "task-1",
            "session-1",
            TransferDirection::Download,
            "/remote/file".to_string(),
            "/local/file".to_string(),
            10,
            1,
        )
    }

    #[test]
    fn queued_task_can_be_cancelled_before_it_runs() {
        let control = TransferTaskControl::new(test_task());
        control.request_cancel().expect("cancel queued task");
        assert!(!control.mark_running().expect("do not start cancelled task"));
        let task = control.snapshot().expect("task snapshot");
        assert_eq!(task.status, TransferStatus::Cancelled);
        assert!(task.started_at.is_none());
        assert!(task.finished_at.is_some());
    }

    #[test]
    fn only_successful_records_expire_after_sixty_seconds() {
        let mut tasks = HashMap::new();
        for (id, status) in [
            ("completed", TransferStatus::Completed),
            ("failed", TransferStatus::Failed),
            ("cancelled", TransferStatus::Cancelled),
            ("running", TransferStatus::Running),
            ("queued", TransferStatus::Queued),
        ] {
            let mut task = test_task();
            task.status = status;
            task.finished_at = Some(1000);
            tasks.insert(id.to_string(), Arc::new(TransferTaskControl::new(task)));
        }
        prune_transfer_tasks(&mut tasks, 60_999);
        assert_eq!(tasks.len(), 5);
        prune_transfer_tasks(&mut tasks, 61_000);
        assert!(!tasks.contains_key("completed"));
        assert_eq!(tasks.len(), 4);
        prune_transfer_tasks(&mut tasks, i64::MAX);
        assert_eq!(tasks.len(), 4);
    }

    #[test]
    fn deletion_rejects_active_tasks_and_is_idempotent_for_finished_tasks() {
        for status in [
            TransferStatus::Queued,
            TransferStatus::Running,
            TransferStatus::Completed,
            TransferStatus::Failed,
            TransferStatus::Cancelled,
        ] {
            let active = matches!(status, TransferStatus::Queued | TransferStatus::Running);
            let mut task = test_task();
            task.status = status;
            let mut tasks = HashMap::from([(
                "task-1".to_string(),
                Arc::new(TransferTaskControl::new(task)),
            )]);
            assert_eq!(
                delete_transfer_record(&mut tasks, "task-1").is_err(),
                active
            );
            assert_eq!(tasks.contains_key("task-1"), active);
            if !active {
                assert!(delete_transfer_record(&mut tasks, "task-1").is_ok());
            }
        }
    }

    #[test]
    fn running_task_transitions_to_completed() {
        let control = TransferTaskControl::new(test_task());
        assert!(control.mark_running().expect("start task"));
        control
            .update_progress(10, 10, Some("file"), 1, 1)
            .expect("update progress");
        control.finish(Ok(())).expect("finish task");
        let task = control.snapshot().expect("task snapshot");
        assert_eq!(task.status, TransferStatus::Completed);
        assert_eq!(task.transferred_bytes, 10);
        assert_eq!(task.completed_files, 1);
        assert!(task.finished_at.is_some());
    }

    #[test]
    fn running_task_transitions_to_failed_with_error() {
        let control = TransferTaskControl::new(test_task());
        assert!(control.mark_running().expect("start task"));
        control
            .finish(Err(AppErrorDto::new(
                AppErrorCode::IoError,
                "failed",
                false,
            )))
            .expect("finish task");
        let task = control.snapshot().expect("task snapshot");
        assert_eq!(task.status, TransferStatus::Failed);
        assert_eq!(task.error.expect("task error").message, "failed");
    }

    #[test]
    fn cancellation_wins_over_a_worker_error() {
        let control = TransferTaskControl::new(test_task());
        assert!(control.mark_running().expect("start task"));
        control.request_cancel().expect("request cancel");
        control
            .finish(Err(AppErrorDto::new(
                AppErrorCode::IoError,
                "cancelled read",
                false,
            )))
            .expect("finish task");
        let task = control.snapshot().expect("task snapshot");
        assert_eq!(task.status, TransferStatus::Cancelled);
        assert!(task.error.is_none());
    }

    #[test]
    fn completion_wins_when_cancel_arrives_after_commit() {
        let control = TransferTaskControl::new(test_task());
        assert!(control.mark_running().expect("start task"));
        control
            .update_progress(10, 10, Some("file"), 1, 1)
            .expect("update progress");
        control.request_cancel().expect("late cancel request");
        control.finish(Ok(())).expect("finish committed task");
        assert_eq!(
            control.snapshot().expect("task snapshot").status,
            TransferStatus::Completed
        );
    }

    #[test]
    fn commits_download_over_an_existing_file() {
        let root = std::env::temp_dir().join(format!("wmcssh-download-test-{}", new_id()));
        std::fs::create_dir_all(&root).expect("create test directory");
        let target = root.join("target.txt");
        let temporary = root.join("temporary.part");
        std::fs::write(&target, b"old").expect("write old target");
        std::fs::write(&temporary, b"new").expect("write temporary download");
        commit_local_path(&temporary, &target).expect("commit temporary download");
        assert_eq!(std::fs::read(&target).expect("read target"), b"new");
        assert!(!temporary.exists());
        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn removing_cancelled_staging_preserves_existing_target() {
        let root = std::env::temp_dir().join(format!("wmcssh-cancel-test-{}", new_id()));
        std::fs::create_dir_all(&root).expect("create test directory");
        let target = root.join("target.txt");
        std::fs::write(&target, b"old").expect("write old target");
        let staging = local_temporary_path(&target, "part").expect("staging path");
        std::fs::write(&staging, b"partial").expect("write staging");
        remove_local_path(&staging).expect("remove staging");
        assert_eq!(std::fs::read(&target).expect("read target"), b"old");
        assert!(!staging.exists());
        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn normalizes_and_joins_remote_paths() {
        assert_eq!(normalize_remote_path(""), "/");
        assert_eq!(normalize_remote_path(" /var/log/// "), "/var/log");
        assert_eq!(join_remote_path("/", "tmp"), "/tmp");
        assert_eq!(join_remote_path("/var", "log"), "/var/log");
    }

    #[test]
    fn rejects_directory_payload_path_traversal() {
        for invalid in [
            "",
            "/absolute",
            "../secret",
            "dir/../secret",
            "dir\\file",
            "dir//file",
        ] {
            assert!(
                validate_relative_path(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
        assert!(validate_relative_path("nested/path/file.txt").is_ok());
    }

    #[test]
    fn rejects_remote_file_names_that_escape_the_selected_directory() {
        for invalid in ["", ".", "..", "nested/file", "nested\\file"] {
            assert!(
                validate_remote_entry_name(invalid, "File name").is_err(),
                "accepted {invalid:?}"
            );
        }
        assert!(validate_remote_entry_name("archive.tar.gz", "File name").is_ok());
    }

    #[test]
    fn bounds_the_number_of_retained_transfer_tasks() {
        assert!(ensure_transfer_task_capacity(MAX_RETAINED_TASKS - 1).is_ok());
        let error = ensure_transfer_task_capacity(MAX_RETAINED_TASKS)
            .expect_err("task capacity must be bounded");
        assert!(matches!(error.code, AppErrorCode::Unsupported));
        assert!(error.retryable);
    }
}
