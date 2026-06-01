use crate::contracts::{
    AppErrorCode, AppErrorDto, CloseFileTransferSessionInput, DownloadRemoteFileInput,
    DownloadRemoteFileResult, DownloadRemotePathInput, DownloadRemotePathResult,
    ListRemoteDirectoryInput, ListRemoteDirectoryResult, OpenFileTransferSessionInput,
    OpenFileTransferSessionResult, RemoteDirectoryFilePayload, RemoteFileEntry,
    RemoteFileEntryType, UploadRemoteDirectoryInput, UploadRemoteFileInput,
};
use crate::services::host_service::HostService;
use crate::ssh::client::connect_ssh_session;
use crate::utils::base64::{decode_base64, encode_base64};
use crate::utils::ids::new_id;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFLNK: u32 = 0o120000;
const ROOT_PATH: &str = "/";
const MAX_DIRECTORY_FILE_COUNT: usize = 1000;
const MAX_DIRECTORY_DEPTH: usize = 10;
const DIRECTORY_LIMIT_MESSAGE: &str = "文件数量过多请打包后上传或下载";

pub struct FileTransferService {
    host_service: Arc<HostService>,
    sessions: Mutex<HashMap<String, FileTransferSession>>,
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
        let content = decode_base64(&input.content_base64)?;
        let mut file = sftp.create(Path::new(&remote_file_path)).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to create remote file {remote_file_path}"),
                err.to_string(),
                true,
            )
        })?;

        file.write_all(&content).map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::IoError,
                format!("Failed to upload remote file {remote_file_path}"),
                err.to_string(),
                true,
            )
        })?;

        Ok(())
    }

    pub async fn upload_remote_directory(
        &self,
        input: UploadRemoteDirectoryInput,
    ) -> Result<(), AppErrorDto> {
        validate_directory_payload(&input.directory_name, &input.directories, &input.files)?;

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
            ensure_remote_directory(&sftp, &join_remote_path(&remote_root_path, &directory))?;
        }

        for file_payload in input.files {
            let remote_file_path = join_remote_path(&remote_root_path, &file_payload.relative_path);
            if let Some(parent) = remote_parent_path(&remote_file_path) {
                ensure_remote_directory(&sftp, &parent)?;
            }

            let content = decode_base64(&file_payload.content_base64)?;
            let mut file = sftp.create(Path::new(&remote_file_path)).map_err(|err| {
                AppErrorDto::with_details(
                    AppErrorCode::IoError,
                    format!("Failed to create remote file {remote_file_path}"),
                    err.to_string(),
                    true,
                )
            })?;

            file.write_all(&content).map_err(|err| {
                AppErrorDto::with_details(
                    AppErrorCode::IoError,
                    format!("Failed to upload remote file {remote_file_path}"),
                    err.to_string(),
                    true,
                )
            })?;
        }

        Ok(())
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
    files: &[RemoteDirectoryFilePayload],
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
