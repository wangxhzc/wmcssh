use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorCode {
    HostNotFound,
    HostInvalid,
    SecretNotFound,
    SecretStoreError,
    AuthFailed,
    NetworkUnreachable,
    Timeout,
    SessionNotFound,
    SessionClosed,
    InputBufferFull,
    IoError,
    DatabaseError,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorDto {
    pub code: AppErrorCode,
    pub message: String,
    pub details: Option<String>,
    pub retryable: bool,
}

impl AppErrorDto {
    pub fn new(code: AppErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            retryable,
        }
    }

    pub fn with_details(
        code: AppErrorCode,
        message: impl Into<String>,
        details: impl Into<String>,
        retryable: bool,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            details: Some(details.into()),
            retryable,
        }
    }

    pub fn host_not_found() -> Self {
        Self::new(AppErrorCode::HostNotFound, "Host not found", false)
    }

    pub fn session_not_found() -> Self {
        Self::new(AppErrorCode::SessionNotFound, "Session not found", false)
    }

    pub fn database(error: impl ToString) -> Self {
        Self::with_details(
            AppErrorCode::DatabaseError,
            "Database error",
            error.to_string(),
            false,
        )
    }

    pub fn io(error: impl ToString) -> Self {
        Self::with_details(AppErrorCode::IoError, "I/O error", error.to_string(), true)
    }
}

impl From<sqlx::Error> for AppErrorDto {
    fn from(value: sqlx::Error) -> Self {
        Self::database(value)
    }
}

impl From<std::io::Error> for AppErrorDto {
    fn from(value: std::io::Error) -> Self {
        Self::io(value)
    }
}
