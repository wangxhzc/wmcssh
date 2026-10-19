use crate::contracts::{AppErrorCode, AppErrorDto};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

pub(super) const MAX_OPEN_FILE_BYTES: u64 = 10 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

struct TemporaryDirectory {
    path: PathBuf,
    retained: bool,
}

impl TemporaryDirectory {
    fn new(parent: &Path) -> Result<Self, AppErrorDto> {
        let path = parent.join(format!("open-{}", crate::utils::ids::new_id()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&path)
                .map_err(AppErrorDto::io)?;
        }
        #[cfg(not(unix))]
        std::fs::create_dir(&path).map_err(AppErrorDto::io)?;
        Ok(Self {
            path,
            retained: false,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        if !self.retained {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

pub(super) fn launch_default_application(path: &Path) -> Result<(), AppErrorDto> {
    launch_native(path).map_err(|error| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            "无法使用系统默认程序打开文件，请检查文件关联和默认应用",
            error.to_string(),
            true,
        )
    })
}

#[cfg(target_os = "linux")]
fn launch_native(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use gtk::gio::{self, prelude::FileExt};
    let uri = gio::File::for_path(path).uri();
    gio::AppInfo::launch_default_for_uri(&uri, None::<&gio::AppLaunchContext>)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn launch_native(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    // Both strings are NUL terminated and live through the synchronous ShellExecuteW call.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result <= 32 {
        return Err(std::io::Error::other(format!("ShellExecuteW error {result}")).into());
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn launch_native(_: &Path) -> Result<(), Box<dyn std::error::Error>> {
    Err(std::io::Error::other("Opening files is unsupported on this platform").into())
}

pub(super) fn file_too_large() -> AppErrorDto {
    AppErrorDto::new(
        AppErrorCode::IoError,
        "文件太大，仅允许打开小于等于 10 MiB 的文件",
        false,
    )
}

pub(super) fn open_temporary_file(
    cache: &Path,
    name: &str,
    source: &mut impl Read,
    launch: impl FnOnce(&Path) -> Result<(), AppErrorDto>,
) -> Result<(), AppErrorDto> {
    validate_local_name(name)?;
    std::fs::create_dir_all(cache).map_err(AppErrorDto::io)?;
    cleanup_expired(cache, SystemTime::now());
    let mut directory = TemporaryDirectory::new(cache)?;
    let path = directory.path().join(name);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(AppErrorDto::io)?;
    let result = (|| {
        copy_limited(source, &mut file)?;
        file.flush().map_err(AppErrorDto::io)
    })();
    // Close before launch or cleanup, including on Windows.
    drop(file);
    result?;
    launch(&path)?;
    // External applications may still be reading or editing the file after launch returns.
    directory.retained = true;
    Ok(())
}

fn validate_local_name(name: &str) -> Result<(), AppErrorDto> {
    let mut parts = Path::new(name).components();
    if name.is_empty()
        || name.contains(['/', '\\', ':', '\0'])
        || !matches!(parts.next(), Some(Component::Normal(_)))
        || parts.next().is_some()
        || name.ends_with(['.', ' '])
    {
        return Err(AppErrorDto::new(
            AppErrorCode::IoError,
            "文件名无法安全保存到本地临时目录",
            false,
        ));
    }
    Ok(())
}

fn copy_limited(source: &mut impl Read, target: &mut impl Write) -> Result<(), AppErrorDto> {
    let mut source = source.take(MAX_OPEN_FILE_BYTES + 1);
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0;
    loop {
        let count = source.read(&mut buffer).map_err(AppErrorDto::io)?;
        if count == 0 {
            return Ok(());
        }
        total += count as u64;
        if total > MAX_OPEN_FILE_BYTES {
            return Err(file_too_large());
        }
        target
            .write_all(&buffer[..count])
            .map_err(AppErrorDto::io)?;
    }
}

fn cleanup_expired(cache: &Path, now: SystemTime) {
    let Ok(entries) = std::fs::read_dir(cache) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.path().symlink_metadata() else {
            continue;
        };
        if !entry.file_name().to_string_lossy().starts_with("open-") || !metadata.is_dir() {
            continue;
        }
        if metadata
            .modified()
            .ok()
            .and_then(|time| now.duration_since(time).ok())
            .is_some_and(|age| age >= RETENTION)
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn test_cache() -> TemporaryDirectory {
        TemporaryDirectory::new(&std::env::temp_dir()).unwrap()
    }

    #[test]
    fn opens_complete_files_with_original_extension_and_unique_paths() {
        let cache = test_cache();
        let mut paths = Vec::new();
        for content in [b"first".as_slice(), b"second".as_slice(), b"".as_slice()] {
            open_temporary_file(
                cache.path(),
                "report.txt",
                &mut Cursor::new(content),
                |path| {
                    assert_eq!(path.file_name().unwrap(), "report.txt");
                    assert_eq!(std::fs::read(path).unwrap(), content);
                    paths.push(path.to_owned());
                    Ok(())
                },
            )
            .unwrap();
        }
        assert_ne!(paths[0], paths[1]);
        assert!(paths.iter().all(|path| path.exists()));
    }

    #[test]
    fn accepts_exact_limit_and_rejects_growth_without_launching() {
        let cache = test_cache();
        let mut target = std::io::sink();
        copy_limited(
            &mut std::io::repeat(0).take(MAX_OPEN_FILE_BYTES),
            &mut target,
        )
        .unwrap();
        let result = open_temporary_file(cache.path(), "big.txt", &mut std::io::repeat(0), |_| {
            panic!("oversized files must not launch")
        });
        assert!(result.unwrap_err().message.contains("文件太大"));
        assert_eq!(std::fs::read_dir(cache.path()).unwrap().count(), 0);
    }

    #[test]
    fn failed_download_or_launch_removes_temporary_files() {
        struct BrokenReader;
        impl Read for BrokenReader {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("connection lost"))
            }
        }
        let cache = test_cache();
        assert!(
            open_temporary_file(cache.path(), "a.txt", &mut BrokenReader, |_| panic!()).is_err()
        );
        assert!(
            open_temporary_file(cache.path(), "a.txt", &mut Cursor::new(b"ok"), |_| {
                Err(AppErrorDto::io("no associated application"))
            })
            .is_err()
        );
        assert_eq!(std::fs::read_dir(cache.path()).unwrap().count(), 0);
    }

    #[test]
    fn rejects_names_that_escape_or_change_the_local_path() {
        for name in [
            "", ".", "..", "/tmp/a", "../a", "a/b", "a\\b", "C:foo", "a\0b", "a.", "a ",
        ] {
            assert!(validate_local_name(name).is_err(), "{name:?}");
        }
        assert!(validate_local_name("文件.txt").is_ok());
    }

    #[test]
    fn cleanup_preserves_recent_and_unrelated_files() {
        let cache = test_cache();
        let old = cache.path().join("open-old");
        std::fs::create_dir(&old).unwrap();
        std::fs::create_dir(cache.path().join("unrelated")).unwrap();
        cleanup_expired(cache.path(), SystemTime::now());
        assert!(old.exists());
        cleanup_expired(
            cache.path(),
            SystemTime::now() + RETENTION + Duration::from_secs(60),
        );
        assert!(!old.exists());
        assert!(cache.path().join("unrelated").exists());
    }
}
