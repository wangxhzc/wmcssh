use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const MAX_LOG_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_LOG_FILES: usize = 4;
const LOG_FILE_NAME: &str = "wmcssh.log";

static LOG_FILE: OnceLock<Mutex<File>> = OnceLock::new();

pub fn init(app_handle: &tauri::AppHandle) -> anyhow::Result<()> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .or_else(|_| app_handle.path().app_data_dir().map(|dir| dir.join("logs")))
        .map_err(|err| anyhow::anyhow!("failed to get app log dir: {err}"))?;

    fs::create_dir_all(&log_dir)?;

    let log_path = log_dir.join(LOG_FILE_NAME);
    rotate_on_startup(&log_path)?;

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let _ = LOG_FILE.set(Mutex::new(file));

    Ok(())
}

fn rotate_on_startup(log_path: &Path) -> anyhow::Result<()> {
    let Ok(metadata) = fs::metadata(log_path) else {
        return Ok(());
    };

    if metadata.len() < MAX_LOG_SIZE_BYTES {
        return Ok(());
    }

    for index in (1..MAX_LOG_FILES).rev() {
        let src = rotated_path(log_path, index);
        let dst = rotated_path(log_path, index + 1);

        if src.exists() {
            if index + 1 >= MAX_LOG_FILES {
                let _ = fs::remove_file(&src);
            } else {
                let _ = fs::rename(&src, &dst);
            }
        }
    }

    fs::rename(log_path, rotated_path(log_path, 1))?;
    Ok(())
}

fn rotated_path(log_path: &Path, index: usize) -> PathBuf {
    let file_name = format!("{LOG_FILE_NAME}.{index}");
    log_path.with_file_name(file_name)
}

pub fn write_line(line: &str) {
    let _ = writeln!(&mut std::io::stderr().lock(), "{line}");

    if let Some(file) = LOG_FILE.get() {
        if let Ok(mut guard) = file.lock() {
            let _ = writeln!(guard, "{line}");
            let _ = guard.flush();
        }
    }
}

#[macro_export]
macro_rules! app_log {
    ($($arg:tt)*) => {{
        $crate::logging::write_line(&format!($($arg)*));
    }};
}
