use crate::contracts::{
    AppErrorCode, AppErrorDto, ConnectionStatus, EpochMillis, ListRecentSessionsInput,
    ListRecentSessionsResult, RecentSessionDto,
};
use crate::utils::time::now_millis;
use sqlx::SqlitePool;

#[derive(Debug, Clone, sqlx::FromRow)]
struct RecentSessionRow {
    id: String,
    host_id: String,
    session_id: Option<String>,
    started_at: i64,
    ended_at: Option<i64>,
    status: String,
    error_code: Option<String>,
    error_message: Option<String>,
    duration_seconds: Option<i64>,
}

pub struct RecentSessionRepository {
    pool: SqlitePool,
}

impl RecentSessionRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn record_connected_session(
        &self,
        host_id: &str,
        session_id: &str,
        started_at: EpochMillis,
    ) -> Result<(), AppErrorDto> {
        sqlx::query(
            r#"
            INSERT INTO recent_sessions (
              id, host_id, session_id, started_at, ended_at,
              status, error_code, error_message, duration_seconds
            )
            VALUES (?, ?, ?, ?, NULL, 'connected', NULL, NULL, NULL)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(host_id)
        .bind(session_id)
        .bind(started_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn mark_session_finished(
        &self,
        session_id: &str,
        status: &str,
        error_code: Option<AppErrorCode>,
        error_message: Option<&str>,
    ) -> Result<(), AppErrorDto> {
        let ended_at = now_millis();
        let row = sqlx::query_as::<_, RecentSessionRow>(
            r#"
            SELECT id, host_id, session_id, started_at, ended_at, status, error_code, error_message, duration_seconds
            FROM recent_sessions
            WHERE session_id = ?
            ORDER BY started_at DESC
            LIMIT 1
            "#,
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(());
        };

        let duration_seconds = Some(((ended_at - row.started_at).max(0)) / 1000);
        let error_code = error_code.map(app_error_code_to_db);

        sqlx::query(
            r#"
            UPDATE recent_sessions
            SET ended_at = ?,
                status = ?,
                error_code = ?,
                error_message = ?,
                duration_seconds = ?
            WHERE id = ?
            "#,
        )
        .bind(ended_at)
        .bind(status)
        .bind(error_code)
        .bind(error_message)
        .bind(duration_seconds)
        .bind(row.id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn list_recent_sessions(
        &self,
        input: Option<ListRecentSessionsInput>,
    ) -> Result<ListRecentSessionsResult, AppErrorDto> {
        let input = input.unwrap_or(ListRecentSessionsInput {
            limit: Some(50),
            host_id: None,
        });

        let limit = input.limit.unwrap_or(50).clamp(1, 200);

        let rows = match input.host_id {
            Some(host_id) => {
                sqlx::query_as::<_, RecentSessionRow>(
                    r#"
                    SELECT id, host_id, session_id, started_at, ended_at, status, error_code, error_message, duration_seconds
                    FROM recent_sessions
                    WHERE host_id = ?
                    ORDER BY started_at DESC
                    LIMIT ?
                    "#,
                )
                .bind(host_id)
                .bind(i64::from(limit))
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query_as::<_, RecentSessionRow>(
                    r#"
                    SELECT id, host_id, session_id, started_at, ended_at, status, error_code, error_message, duration_seconds
                    FROM recent_sessions
                    ORDER BY started_at DESC
                    LIMIT ?
                    "#,
                )
                .bind(i64::from(limit))
                .fetch_all(&self.pool)
                .await?
            }
        };

        let sessions = rows
            .into_iter()
            .map(|row| RecentSessionDto {
                id: row.id,
                host_id: row.host_id,
                session_id: row.session_id,
                started_at: row.started_at,
                ended_at: row.ended_at,
                status: parse_connection_status(&row.status),
                error_code: row.error_code.and_then(|code| parse_error_code(&code)),
                error_message: row.error_message,
                duration_seconds: row.duration_seconds,
            })
            .collect();

        Ok(ListRecentSessionsResult { sessions })
    }
}

fn parse_connection_status(value: &str) -> ConnectionStatus {
    match value {
        "connected" => ConnectionStatus::Connected,
        "disconnected" => ConnectionStatus::Disconnected,
        "failed" => ConnectionStatus::Failed,
        "auth_failed" => ConnectionStatus::AuthFailed,
        "timeout" => ConnectionStatus::Timeout,
        "network_error" => ConnectionStatus::NetworkError,
        _ => ConnectionStatus::Disconnected,
    }
}

fn parse_error_code(value: &str) -> Option<AppErrorCode> {
    let json = format!("\"{value}\"");
    serde_json::from_str::<AppErrorCode>(&json).ok()
}

fn app_error_code_to_db(code: AppErrorCode) -> String {
    match code {
        AppErrorCode::HostNotFound => "host_not_found",
        AppErrorCode::HostInvalid => "host_invalid",
        AppErrorCode::SecretNotFound => "secret_not_found",
        AppErrorCode::SecretStoreError => "secret_store_error",
        AppErrorCode::AuthFailed => "auth_failed",
        AppErrorCode::NetworkUnreachable => "network_unreachable",
        AppErrorCode::Timeout => "timeout",
        AppErrorCode::SessionNotFound => "session_not_found",
        AppErrorCode::SessionClosed => "session_closed",
        AppErrorCode::InputBufferFull => "input_buffer_full",
        AppErrorCode::IoError => "io_error",
        AppErrorCode::DatabaseError => "database_error",
        AppErrorCode::Unsupported => "unsupported",
        AppErrorCode::Unknown => "unknown",
    }
    .to_string()
}
