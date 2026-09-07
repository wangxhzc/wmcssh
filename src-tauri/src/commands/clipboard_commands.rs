use crate::contracts::{AppErrorCode, AppErrorDto};

#[tauri::command]
pub async fn read_primary_selection(app: tauri::AppHandle) -> Result<Option<String>, AppErrorDto> {
    #[cfg(target_os = "linux")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            gtk::Clipboard::get(&gtk::gdk::SELECTION_PRIMARY).request_text(move |_, text| {
                let _ = sender.send(text.map(str::to_owned));
            });
        })
        .map_err(|_| clipboard_error())?;
        tokio::time::timeout(std::time::Duration::from_secs(2), receiver)
            .await
            .map_err(|_| clipboard_error())?
            .map_err(|_| clipboard_error())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err(AppErrorDto::new(
            AppErrorCode::Unsupported,
            "PRIMARY selection is only available on Linux",
            false,
        ))
    }
}

#[tauri::command]
pub async fn write_primary_selection(
    app: tauri::AppHandle,
    text: String,
) -> Result<(), AppErrorDto> {
    #[cfg(target_os = "linux")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            gtk::Clipboard::get(&gtk::gdk::SELECTION_PRIMARY).set_text(&text);
            let _ = sender.send(());
        })
        .map_err(|_| clipboard_error())?;
        receiver.await.map_err(|_| clipboard_error())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, text);
        Err(AppErrorDto::new(
            AppErrorCode::Unsupported,
            "PRIMARY selection is only available on Linux",
            false,
        ))
    }
}

#[cfg(target_os = "linux")]
fn clipboard_error() -> AppErrorDto {
    AppErrorDto::new(
        AppErrorCode::IoError,
        "Unable to access PRIMARY selection",
        true,
    )
}
