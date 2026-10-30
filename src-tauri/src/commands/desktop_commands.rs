use crate::contracts::{AppErrorCode, AppErrorDto};

fn validated_web_url(value: &str) -> Result<String, AppErrorDto> {
    let invalid = || {
        AppErrorDto::new(
            AppErrorCode::Unsupported,
            "仅支持 HTTP/HTTPS 网页链接",
            false,
        )
    };
    if value.len() > 8192 || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(invalid());
    }
    let url = tauri::Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid());
    }
    Ok(url.to_string())
}

#[tauri::command]
pub async fn open_web_link(app: tauri::AppHandle, url: String) -> Result<(), AppErrorDto> {
    let url = validated_web_url(&url)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(launch_web_url(&url));
    })
    .map_err(AppErrorDto::io)?;
    receiver.await.map_err(AppErrorDto::io)?
}

#[cfg(target_os = "linux")]
fn launch_web_url(url: &str) -> Result<(), AppErrorDto> {
    use gtk::gio;
    gio::AppInfo::launch_default_for_uri(url, None::<&gio::AppLaunchContext>)
        .map_err(AppErrorDto::io)
}

#[cfg(target_os = "windows")]
fn launch_web_url(url: &str) -> Result<(), AppErrorDto> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let url: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    // URL and verb remain NUL terminated and alive throughout the native call.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result <= 32 {
        return Err(AppErrorDto::io(format!("ShellExecuteW error {result}")));
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn launch_web_url(_: &str) -> Result<(), AppErrorDto> {
    Err(AppErrorDto::new(
        AppErrorCode::Unsupported,
        "此平台暂不支持打开网页",
        false,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_web_urls_without_credentials_or_controls() {
        assert_eq!(
            validated_web_url("https://example.com/a?q=1#b").unwrap(),
            "https://example.com/a?q=1#b"
        );
        assert!(validated_web_url("http://localhost:3000/").is_ok());
        for value in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://user:pass@example.com",
            "https://example.com/\n",
            "https://",
            "https://example.com/\0",
        ] {
            assert!(validated_web_url(value).is_err());
        }
        assert!(validated_web_url(&format!("https://example.com/{}", "a".repeat(8192))).is_err());
    }
}
