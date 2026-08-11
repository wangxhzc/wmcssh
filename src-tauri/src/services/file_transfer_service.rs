use crate::contracts::{
    AppErrorCode, AppErrorDto, CloseFileTransferSessionInput, DownloadRemoteFileInput,
    DownloadRemoteFileResult, DownloadRemotePathInput, DownloadRemotePathResult,
    ListRemoteDirectoryInput, ListRemoteDirectoryResult, OpenFileTransferSessionInput,
    OpenFileTransferSessionResult, RemoteDirectoryFilePayload, RemoteFileEntry,
    RemoteFileEntryType, UploadProgress, UploadRemoteDirectoryFilePayload,
    UploadRemoteDirectoryInput, UploadRemoteFileInput,
};
use crate::services::host_service::HostService;
use crate::ssh::client::connect_ssh_session;
use crate::utils::base64::encode_base64;
use crate::utils::ids::new_id;
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
const DIRECTORY_LIMIT_MESSAGE: &str = "文件数量过多请打包后上传或下载";
const UPLOAD_BUFFER_SIZE: usize = 256 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

pub struct FileTransferService {
    host_service: Arc<HostService>,
    sessions: Mutex<HashMap<String, FileTransferSession>>,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

struct FileTransferSession {
    host_id: String,
    _session: ssh2::Session,
    sftp: ssh2::Sftp,
}

impl FileTransferService {
    pub fn new(host_service: Arc<HostService>) -> Self {
        Self {
            host_service,
            sessions: Mutex::new(HashMap::new()),
            cancellations: Mutex::new(HashMap::new()),
        }
    }

    pub async fn open_file_transfer_session(
        &self,
        input: OpenFileTransferSessionInput,
    ) -> Result<OpenFileTransferSessionResult, AppErrorDto> {
        let config = self
            .host_service
            .build_connect_config(&input.host_id, 0, 0)
            .await?;
        let session = connect_ssh_session(&config)?;
        let sftp = session.sftp().map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                "Failed to open SFTP session",
                err.to_string(),
                true,
            )
        })?;
        let transfer_session_id = new_id();

        self.sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?
            .insert(
                transfer_session_id.clone(),
                FileTransferSession {
                    host_id: input.host_id,
                    _session: session,
                    sftp,
                },
            );

        Ok(OpenFileTransferSessionResult {
            transfer_session_id,
        })
    }

    pub async fn close_file_transfer_session(
        &self,
        input: CloseFileTransferSessionInput,
    ) -> Result<(), AppErrorDto> {
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
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?;
        let transfer_session = sessions
            .get(&input.transfer_session_id)
            .ok_or_else(AppErrorDto::session_not_found)?;
        let sftp = &transfer_session.sftp;

        let (path, fallback_to_root) = resolve_remote_directory_path(sftp, input.path.as_deref());

        let entries = sftp.readdir(Path::new(&path)).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to read remote directory {path}"),
                err.to_string(),
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

    pub async fn upload_remote_file(
        &self,
        input: UploadRemoteFileInput,
        on_progress: Channel<UploadProgress>,
    ) -> Result<(), AppErrorDto> {
        let cancel = self.register_upload(&input.transfer_id)?;
        let result = self.upload_remote_file_inner(&input, &on_progress, &cancel);
        self.finish_upload(&input.transfer_id);
        result
    }

    fn upload_remote_file_inner(
        &self,
        input: &UploadRemoteFileInput,
        on_progress: &Channel<UploadProgress>,
        cancel: &AtomicBool,
    ) -> Result<(), AppErrorDto> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?;
        let transfer_session = sessions
            .get(&input.transfer_session_id)
            .ok_or_else(AppErrorDto::session_not_found)?;
        let sftp = &transfer_session.sftp;

        let remote_dir_path = normalize_remote_path(&input.remote_dir_path);
        let remote_file_path = join_remote_path(&remote_dir_path, &input.file_name);
        let mut local_file = std::fs::File::open(&input.local_file_path).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to open local file {}", input.local_file_path),
                err.to_string(),
                true,
            )
        })?;
        let total_bytes = local_file.metadata().map_err(AppErrorDto::io)?.len();
        let mut remote_file = sftp.create(Path::new(&remote_file_path)).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to create remote file {remote_file_path}"),
                err.to_string(),
                true,
            )
        })?;

        let result = copy_with_progress(
            &mut local_file,
            &mut remote_file,
            cancel,
            on_progress,
            &input.transfer_id,
            total_bytes,
            &input.file_name,
            0,
            1,
            0,
        );
        if result.is_err() {
            let _ = sftp.unlink(Path::new(&remote_file_path));
        }
        result?;

        Ok(())
    }

    pub async fn upload_remote_directory(
        &self,
        input: UploadRemoteDirectoryInput,
        on_progress: Channel<UploadProgress>,
    ) -> Result<(), AppErrorDto> {
        validate_directory_payload(&input.directory_name, &input.directories, &input.files)?;
        let cancel = self.register_upload(&input.transfer_id)?;
        let result = self.upload_remote_directory_inner(input, &on_progress, &cancel);
        self.finish_upload(&result.1);
        result.0
    }

    fn upload_remote_directory_inner(
        &self,
        input: UploadRemoteDirectoryInput,
        on_progress: &Channel<UploadProgress>,
        cancel: &AtomicBool,
    ) -> (Result<(), AppErrorDto>, String) {
        let transfer_id = input.transfer_id.clone();
        let result = (|| {
            let total_bytes = input.files.iter().try_fold(0u64, |total, file| {
                std::fs::metadata(&file.local_file_path)
                    .map(|meta| total.saturating_add(meta.len()))
                    .map_err(AppErrorDto::io)
            })?;
            let total_files = input.files.len();

            let sessions = self
                .sessions
                .lock()
                .map_err(|_| file_transfer_sessions_lock_error())?;
            let transfer_session = sessions
                .get(&input.transfer_session_id)
                .ok_or_else(AppErrorDto::session_not_found)?;
            let sftp = &transfer_session.sftp;

            let remote_dir_path = normalize_remote_path(&input.remote_dir_path);
            let remote_root_path = join_remote_path(&remote_dir_path, &input.directory_name);
            ensure_remote_directory(&sftp, &remote_root_path)?;

            let mut directories = input.directories;
            directories.sort_by_key(|path| relative_depth(path));
            for directory in directories {
                check_cancelled(cancel)?;
                ensure_remote_directory(&sftp, &join_remote_path(&remote_root_path, &directory))?;
            }

            let mut uploaded_bytes = 0u64;
            for (index, file_payload) in input.files.into_iter().enumerate() {
                check_cancelled(cancel)?;
                let remote_file_path =
                    join_remote_path(&remote_root_path, &file_payload.relative_path);
                if let Some(parent) = remote_parent_path(&remote_file_path) {
                    ensure_remote_directory(&sftp, &parent)?;
                }

                let mut local_file =
                    std::fs::File::open(&file_payload.local_file_path).map_err(|err| {
                        AppErrorDto::with_details(
                            AppErrorCode::IoError,
                            format!("Failed to open local file {}", file_payload.local_file_path),
                            err.to_string(),
                            true,
                        )
                    })?;
                let mut remote_file = sftp.create(Path::new(&remote_file_path)).map_err(|err| {
                    AppErrorDto::with_details(
                        AppErrorCode::IoError,
                        format!("Failed to create remote file {remote_file_path}"),
                        err.to_string(),
                        true,
                    )
                })?;

                let result = copy_with_progress(
                    &mut local_file,
                    &mut remote_file,
                    cancel,
                    on_progress,
                    &input.transfer_id,
                    total_bytes,
                    &file_payload.relative_path,
                    index,
                    total_files,
                    uploaded_bytes,
                );
                if result.is_err() {
                    let _ = sftp.unlink(Path::new(&remote_file_path));
                }
                uploaded_bytes = result?;
            }

            Ok(())
        })();
        (result, transfer_id)
    }

    pub fn cancel_upload(&self, transfer_id: &str) -> Result<(), AppErrorDto> {
        if let Some(flag) = self
            .cancellations
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?
            .get(transfer_id)
        {
            flag.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    fn register_upload(&self, transfer_id: &str) -> Result<Arc<AtomicBool>, AppErrorDto> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancellations
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?
            .insert(transfer_id.to_string(), flag.clone());
        Ok(flag)
    }

    fn finish_upload(&self, transfer_id: &str) {
        if let Ok(mut uploads) = self.cancellations.lock() {
            uploads.remove(transfer_id);
        }
    }

    pub async fn download_remote_file(
        &self,
        input: DownloadRemoteFileInput,
    ) -> Result<DownloadRemoteFileResult, AppErrorDto> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?;
        let transfer_session = sessions
            .get(&input.transfer_session_id)
            .ok_or_else(AppErrorDto::session_not_found)?;
        let sftp = &transfer_session.sftp;

        let remote_file_path = normalize_remote_path(&input.remote_file_path);
        let mut file = sftp.open(Path::new(&remote_file_path)).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to open remote file {remote_file_path}"),
                err.to_string(),
                true,
            )
        })?;

        let mut content = Vec::new();
        file.read_to_end(&mut content).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to download remote file {remote_file_path}"),
                err.to_string(),
                true,
            )
        })?;

        let file_name = Path::new(&remote_file_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                AppErrorDto::new(AppErrorCode::IoError, "Remote file name is invalid", false)
            })?;

        Ok(DownloadRemoteFileResult {
            file_name,
            content_base64: encode_base64(&content),
        })
    }

    pub async fn download_remote_path(
        &self,
        input: DownloadRemotePathInput,
    ) -> Result<DownloadRemotePathResult, AppErrorDto> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| file_transfer_sessions_lock_error())?;
        let transfer_session = sessions
            .get(&input.transfer_session_id)
            .ok_or_else(AppErrorDto::session_not_found)?;
        let sftp = &transfer_session.sftp;

        let remote_path = normalize_remote_path(&input.remote_path);
        let name = remote_file_name(&remote_path)?;
        let stat = sftp.stat(Path::new(&remote_path)).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to stat remote path {remote_path}"),
                err.to_string(),
                true,
            )
        })?;
        let entry_type = detect_remote_entry_type(&sftp, &remote_path, &stat);

        if entry_type != RemoteFileEntryType::Directory {
            let content = read_remote_file(&sftp, &remote_path)?;
            return Ok(DownloadRemotePathResult {
                name,
                entry_type,
                content_base64: Some(encode_base64(&content)),
                directories: Vec::new(),
                files: Vec::new(),
            });
        }

        let mut result = DownloadRemotePathResult {
            name,
            entry_type,
            content_base64: None,
            directories: Vec::new(),
            files: Vec::new(),
        };
        collect_remote_directory(&sftp, &remote_path, "", 0, &mut result)?;
        Ok(result)
    }
}

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        ROOT_PATH.to_string()
    } else if trimmed == ROOT_PATH {
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

    let path = join_remote_path(parent_path, &name);
    Some(RemoteFileEntry {
        name,
        path,
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
        Err(_) => sftp.mkdir(Path::new(path), 0o755).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to create remote directory {path}"),
                err.to_string(),
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
    if directory_name.trim().is_empty()
        || directory_name.contains('/')
        || directory_name.contains('\\')
        || directory_name == "."
        || directory_name == ".."
    {
        return Err(AppErrorDto::new(
            AppErrorCode::IoError,
            "Directory name is invalid",
            false,
        ));
    }

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

#[allow(clippy::too_many_arguments)]
fn copy_with_progress(
    local_file: &mut std::fs::File,
    remote_file: &mut ssh2::File,
    cancel: &AtomicBool,
    on_progress: &Channel<UploadProgress>,
    transfer_id: &str,
    total_bytes: u64,
    current_file: &str,
    completed_files: usize,
    total_files: usize,
    initial_uploaded_bytes: u64,
) -> Result<u64, AppErrorDto> {
    let mut buffer = vec![0u8; UPLOAD_BUFFER_SIZE];
    let mut uploaded_bytes = initial_uploaded_bytes;
    let mut last_report = Instant::now() - PROGRESS_INTERVAL;
    emit_upload_progress(
        on_progress,
        transfer_id,
        uploaded_bytes,
        total_bytes,
        current_file,
        completed_files,
        total_files,
    );

    loop {
        check_cancelled(cancel)?;
        let count = local_file.read(&mut buffer).map_err(AppErrorDto::io)?;
        if count == 0 {
            break;
        }
        remote_file.write_all(&buffer[..count]).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to upload {current_file}"),
                err.to_string(),
                true,
            )
        })?;
        uploaded_bytes = uploaded_bytes.saturating_add(count as u64);
        if last_report.elapsed() >= PROGRESS_INTERVAL {
            emit_upload_progress(
                on_progress,
                transfer_id,
                uploaded_bytes,
                total_bytes,
                current_file,
                completed_files,
                total_files,
            );
            last_report = Instant::now();
        }
    }

    emit_upload_progress(
        on_progress,
        transfer_id,
        uploaded_bytes,
        total_bytes,
        current_file,
        completed_files + 1,
        total_files,
    );
    Ok(uploaded_bytes)
}

fn emit_upload_progress(
    channel: &Channel<UploadProgress>,
    transfer_id: &str,
    uploaded_bytes: u64,
    total_bytes: u64,
    current_file: &str,
    completed_files: usize,
    total_files: usize,
) {
    let _ = channel.send(UploadProgress {
        transfer_id: transfer_id.to_string(),
        uploaded_bytes,
        total_bytes,
        current_file: current_file.to_string(),
        completed_files,
        total_files,
    });
}

fn check_cancelled(cancel: &AtomicBool) -> Result<(), AppErrorDto> {
    if cancel.load(Ordering::Relaxed) {
        Err(AppErrorDto::new(AppErrorCode::IoError, "上传已取消", false))
    } else {
        Ok(())
    }
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

fn remote_file_name(path: &str) -> Result<String, AppErrorDto> {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            AppErrorDto::new(AppErrorCode::IoError, "Remote path name is invalid", false)
        })
}

fn read_remote_file(sftp: &ssh2::Sftp, remote_file_path: &str) -> Result<Vec<u8>, AppErrorDto> {
    let mut file = sftp.open(Path::new(remote_file_path)).map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            format!("Failed to open remote file {remote_file_path}"),
            err.to_string(),
            true,
        )
    })?;

    let mut content = Vec::new();
    file.read_to_end(&mut content).map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            format!("Failed to download remote file {remote_file_path}"),
            err.to_string(),
            true,
        )
    })?;

    Ok(content)
}

fn collect_remote_directory(
    sftp: &ssh2::Sftp,
    remote_dir_path: &str,
    relative_dir_path: &str,
    depth: usize,
    result: &mut DownloadRemotePathResult,
) -> Result<(), AppErrorDto> {
    if depth > MAX_DIRECTORY_DEPTH {
        return Err(directory_limit_error());
    }

    let entries = sftp.readdir(Path::new(remote_dir_path)).map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            format!("Failed to read remote directory {remote_dir_path}"),
            err.to_string(),
            true,
        )
    })?;

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

        let relative_path = if relative_dir_path.is_empty() {
            name.clone()
        } else {
            format!("{relative_dir_path}/{name}")
        };
        if relative_depth(&relative_path) > MAX_DIRECTORY_DEPTH {
            return Err(directory_limit_error());
        }

        let remote_path = join_remote_path(remote_dir_path, &name);
        match detect_remote_entry_type(sftp, &remote_path, &stat) {
            RemoteFileEntryType::Directory => {
                result.directories.push(relative_path.clone());
                collect_remote_directory(sftp, &remote_path, &relative_path, depth + 1, result)?;
            }
            RemoteFileEntryType::File => {
                if result.files.len() >= MAX_DIRECTORY_FILE_COUNT {
                    return Err(directory_limit_error());
                }
                let content = read_remote_file(sftp, &remote_path)?;
                result.files.push(RemoteDirectoryFilePayload {
                    relative_path,
                    content_base64: encode_base64(&content),
                });
            }
            RemoteFileEntryType::Symlink | RemoteFileEntryType::Other => {}
        }
    }

    Ok(())
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
