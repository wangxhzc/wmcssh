use crate::contracts::{AppErrorDto, AuthType, ConnectionStatus, HostDto, HostFilter, TagDto};
use sqlx::{sqlite::Sqlite, QueryBuilder, SqlitePool, Transaction};
use std::collections::HashMap;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct HostRecord {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: i64,
    pub username: String,
    pub auth_type: String,
    pub password_ref: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_ref: Option<String>,
    pub passphrase_ref: Option<String>,
    pub group_id: Option<String>,
    pub startup_command: Option<String>,
    pub terminal_theme: Option<String>,
    pub connect_timeout_ms: i64,
    pub keepalive_interval_secs: i64,
    #[allow(dead_code)]
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct CreateHostRecord {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub password_ref: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_ref: Option<String>,
    pub passphrase_ref: Option<String>,
    pub group_id: Option<String>,
    pub tag_ids: Vec<String>,
    pub startup_command: Option<String>,
    pub terminal_theme: Option<String>,
    pub connect_timeout_ms: u64,
    pub keepalive_interval_secs: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct UpdateHostRecord {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub password_ref: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_ref: Option<String>,
    pub passphrase_ref: Option<String>,
    pub group_id: Option<String>,
    pub tag_ids: Vec<String>,
    pub startup_command: Option<String>,
    pub terminal_theme: Option<String>,
    pub connect_timeout_ms: u64,
    pub keepalive_interval_secs: u64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
struct RecentSessionSummary {
    started_at: i64,
    status: String,
    error_message: Option<String>,
}

pub struct HostRepository {
    pool: SqlitePool,
}

impl HostRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn create_host(&self, input: CreateHostRecord) -> Result<HostRecord, AppErrorDto> {
        let mut tx = self.pool.begin().await?;
        let auth_type = auth_type_to_str(&input.auth_type);

        sqlx::query(
            r#"
            INSERT INTO hosts (
              id, name, hostname, port, username, auth_type,
              password_ref, private_key_path, private_key_ref, passphrase_ref,
              group_id, startup_command, terminal_theme,
              connect_timeout_ms, keepalive_interval_secs,
              sort_order, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            "#,
        )
        .bind(&input.id)
        .bind(&input.name)
        .bind(&input.hostname)
        .bind(i64::from(input.port))
        .bind(&input.username)
        .bind(auth_type)
        .bind(&input.password_ref)
        .bind(&input.private_key_path)
        .bind(&input.private_key_ref)
        .bind(&input.passphrase_ref)
        .bind(&input.group_id)
        .bind(&input.startup_command)
        .bind(&input.terminal_theme)
        .bind(i64::try_from(input.connect_timeout_ms).unwrap_or(i64::MAX))
        .bind(i64::try_from(input.keepalive_interval_secs).unwrap_or(i64::MAX))
        .bind(input.created_at)
        .bind(input.updated_at)
        .execute(&mut *tx)
        .await?;

        self.replace_host_tags(&mut tx, &input.id, &input.tag_ids)
            .await?;
        tx.commit().await?;

        self.get_host(&input.id).await
    }

    pub async fn update_host(&self, input: UpdateHostRecord) -> Result<HostRecord, AppErrorDto> {
        let mut tx = self.pool.begin().await?;
        let auth_type = auth_type_to_str(&input.auth_type);

        sqlx::query(
            r#"
            UPDATE hosts
            SET name = ?,
                hostname = ?,
                port = ?,
                username = ?,
                auth_type = ?,
                password_ref = ?,
                private_key_path = ?,
                private_key_ref = ?,
                passphrase_ref = ?,
                group_id = ?,
                startup_command = ?,
                terminal_theme = ?,
                connect_timeout_ms = ?,
                keepalive_interval_secs = ?,
                updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(&input.name)
        .bind(&input.hostname)
        .bind(i64::from(input.port))
        .bind(&input.username)
        .bind(auth_type)
        .bind(&input.password_ref)
        .bind(&input.private_key_path)
        .bind(&input.private_key_ref)
        .bind(&input.passphrase_ref)
        .bind(&input.group_id)
        .bind(&input.startup_command)
        .bind(&input.terminal_theme)
        .bind(i64::try_from(input.connect_timeout_ms).unwrap_or(i64::MAX))
        .bind(i64::try_from(input.keepalive_interval_secs).unwrap_or(i64::MAX))
        .bind(input.updated_at)
        .bind(&input.id)
        .execute(&mut *tx)
        .await?;

        self.replace_host_tags(&mut tx, &input.id, &input.tag_ids)
            .await?;
        tx.commit().await?;

        self.get_host(&input.id).await
    }

    pub async fn get_host(&self, host_id: &str) -> Result<HostRecord, AppErrorDto> {
        let record = sqlx::query_as::<_, HostRecord>("SELECT * FROM hosts WHERE id = ?")
            .bind(host_id)
            .fetch_optional(&self.pool)
            .await?;

        record.ok_or_else(AppErrorDto::host_not_found)
    }

    pub async fn list_hosts(
        &self,
        filter: Option<HostFilter>,
    ) -> Result<Vec<HostRecord>, AppErrorDto> {
        let filter = filter.unwrap_or(HostFilter {
            keyword: None,
            group_id: None,
            tag_ids: None,
            auth_type: None,
            recently_connected: None,
        });

        let mut builder = QueryBuilder::<Sqlite>::new("SELECT DISTINCT hosts.* FROM hosts");

        if filter
            .tag_ids
            .as_ref()
            .is_some_and(|tag_ids| !tag_ids.is_empty())
        {
            builder.push(" INNER JOIN host_tags ON host_tags.host_id = hosts.id");
        }

        builder.push(" WHERE 1 = 1");

        if let Some(keyword) = filter
            .keyword
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            let pattern = format!("%{keyword}%");
            let pattern_name = pattern.clone();
            let pattern_hostname = pattern.clone();
            builder.push(" AND (hosts.name LIKE ");
            builder.push_bind(pattern_name);
            builder.push(" OR hosts.hostname LIKE ");
            builder.push_bind(pattern_hostname);
            builder.push(" OR hosts.username LIKE ");
            builder.push_bind(pattern);
            builder.push(")");
        }

        if let Some(group_id) = filter.group_id.as_ref() {
            builder.push(" AND hosts.group_id = ");
            builder.push_bind(group_id);
        }

        if let Some(auth_type) = filter.auth_type.as_ref() {
            builder.push(" AND hosts.auth_type = ");
            builder.push_bind(auth_type_to_str(auth_type));
        }

        if filter.recently_connected.unwrap_or(false) {
            builder.push(
                " AND EXISTS (SELECT 1 FROM recent_sessions rs WHERE rs.host_id = hosts.id AND rs.status = 'connected')",
            );
        }

        if let Some(tag_ids) = filter
            .tag_ids
            .as_ref()
            .filter(|tag_ids| !tag_ids.is_empty())
        {
            builder.push(" AND host_tags.tag_id IN (");
            let mut first = true;
            for tag_id in tag_ids {
                if !first {
                    builder.push(", ");
                }
                first = false;
                builder.push_bind(tag_id);
            }
            builder.push(")");
        }

        builder.push(" ORDER BY hosts.sort_order ASC, hosts.updated_at DESC");

        Ok(builder
            .build_query_as::<HostRecord>()
            .fetch_all(&self.pool)
            .await?)
    }

    pub async fn delete_host(&self, host_id: &str) -> Result<(), AppErrorDto> {
        sqlx::query("DELETE FROM hosts WHERE id = ?")
            .bind(host_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_tags_for_host(&self, host_id: &str) -> Result<Vec<TagDto>, AppErrorDto> {
        let tags = self.list_tags_for_hosts(&[host_id.to_string()]).await?;
        Ok(tags.get(host_id).cloned().unwrap_or_default())
    }

    pub async fn list_tags_for_hosts(
        &self,
        host_ids: &[String],
    ) -> Result<HashMap<String, Vec<TagDto>>, AppErrorDto> {
        if host_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut builder = QueryBuilder::<Sqlite>::new(
            r#"
            SELECT host_tags.host_id, tags.id, tags.name, tags.color, tags.created_at, tags.updated_at
            FROM tags
            INNER JOIN host_tags ON host_tags.tag_id = tags.id
            WHERE host_tags.host_id IN (
            "#,
        );
        let mut separated = builder.separated(", ");
        for host_id in host_ids {
            separated.push_bind(host_id);
        }
        separated.push_unseparated(") ORDER BY host_tags.host_id ASC, tags.name ASC");

        let rows = builder
            .build_query_as::<HostTagRow>()
            .fetch_all(&self.pool)
            .await?;

        let mut grouped = HashMap::new();
        for row in rows {
            grouped
                .entry(row.host_id)
                .or_insert_with(Vec::new)
                .push(TagDto {
                    id: row.id,
                    name: row.name,
                    color: row.color,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                });
        }

        Ok(grouped)
    }

    async fn latest_recent_session(
        &self,
        host_id: &str,
    ) -> Result<Option<RecentSessionSummary>, AppErrorDto> {
        let recent = self.latest_recent_sessions(&[host_id.to_string()]).await?;
        Ok(recent.get(host_id).cloned())
    }

    async fn latest_recent_sessions(
        &self,
        host_ids: &[String],
    ) -> Result<HashMap<String, RecentSessionSummary>, AppErrorDto> {
        if host_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut builder = QueryBuilder::<Sqlite>::new(
            r#"
            SELECT recent_sessions.host_id, recent_sessions.started_at, recent_sessions.status, recent_sessions.error_message
            FROM recent_sessions
            INNER JOIN (
                SELECT host_id, MAX(started_at) AS started_at
                FROM recent_sessions
                WHERE host_id IN (
            "#,
        );
        let mut separated = builder.separated(", ");
        for host_id in host_ids {
            separated.push_bind(host_id);
        }
        separated.push_unseparated(
            r#"
                )
                GROUP BY host_id
            ) latest
              ON latest.host_id = recent_sessions.host_id
             AND latest.started_at = recent_sessions.started_at
            "#,
        );

        let rows = builder
            .build_query_as::<RecentSessionHostRow>()
            .fetch_all(&self.pool)
            .await?;

        let mut grouped = HashMap::new();
        for row in rows {
            grouped.insert(
                row.host_id,
                RecentSessionSummary {
                    started_at: row.started_at,
                    status: row.status,
                    error_message: row.error_message,
                },
            );
        }

        Ok(grouped)
    }

    pub async fn to_host_dto(&self, record: HostRecord) -> Result<HostDto, AppErrorDto> {
        let tags = self.list_tags_for_host(&record.id).await?;
        let recent = self.latest_recent_session(&record.id).await?;
        let last_connected_at = recent.as_ref().map(|summary| summary.started_at);
        let last_status = recent
            .as_ref()
            .and_then(|summary| parse_connection_status(&summary.status).ok());
        let last_error_message = recent.and_then(|summary| summary.error_message);

        Ok(HostDto {
            id: record.id,
            name: record.name,
            hostname: record.hostname,
            port: record.port as u16,
            username: record.username,
            auth_type: parse_auth_type(&record.auth_type)?,
            has_password: record.password_ref.is_some(),
            private_key_path: record.private_key_path,
            has_passphrase: record.passphrase_ref.is_some(),
            group_id: record.group_id,
            tags,
            connect_timeout_ms: record.connect_timeout_ms as u64,
            keepalive_interval_secs: record.keepalive_interval_secs as u64,
            startup_command: record.startup_command,
            terminal_theme: record.terminal_theme,
            last_connected_at,
            last_status,
            last_error_message,
            created_at: record.created_at,
            updated_at: record.updated_at,
        })
    }

    pub async fn to_host_dtos(
        &self,
        records: Vec<HostRecord>,
    ) -> Result<Vec<HostDto>, AppErrorDto> {
        if records.is_empty() {
            return Ok(Vec::new());
        }

        let host_ids: Vec<String> = records.iter().map(|record| record.id.clone()).collect();
        let tags_by_host = self.list_tags_for_hosts(&host_ids).await?;
        let recent_by_host = self.latest_recent_sessions(&host_ids).await?;

        let mut dtos = Vec::with_capacity(records.len());
        for record in records {
            let recent = recent_by_host.get(&record.id);
            dtos.push(HostDto {
                id: record.id.clone(),
                name: record.name,
                hostname: record.hostname,
                port: record.port as u16,
                username: record.username,
                auth_type: parse_auth_type(&record.auth_type)?,
                has_password: record.password_ref.is_some(),
                private_key_path: record.private_key_path,
                has_passphrase: record.passphrase_ref.is_some(),
                group_id: record.group_id,
                tags: tags_by_host.get(&record.id).cloned().unwrap_or_default(),
                connect_timeout_ms: record.connect_timeout_ms as u64,
                keepalive_interval_secs: record.keepalive_interval_secs as u64,
                startup_command: record.startup_command,
                terminal_theme: record.terminal_theme,
                last_connected_at: recent.as_ref().map(|summary| summary.started_at),
                last_status: recent
                    .as_ref()
                    .and_then(|summary| parse_connection_status(&summary.status).ok()),
                last_error_message: recent.and_then(|summary| summary.error_message.clone()),
                created_at: record.created_at,
                updated_at: record.updated_at,
            });
        }

        Ok(dtos)
    }

    async fn replace_host_tags(
        &self,
        tx: &mut Transaction<'_, sqlx::Sqlite>,
        host_id: &str,
        tag_ids: &[String],
    ) -> Result<(), AppErrorDto> {
        sqlx::query("DELETE FROM host_tags WHERE host_id = ?")
            .bind(host_id)
            .execute(&mut **tx)
            .await?;

        for tag_id in tag_ids {
            sqlx::query("INSERT INTO host_tags (host_id, tag_id) VALUES (?, ?)")
                .bind(host_id)
                .bind(tag_id)
                .execute(&mut **tx)
                .await?;
        }

        Ok(())
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct HostTagRow {
    host_id: String,
    id: String,
    name: String,
    color: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct RecentSessionHostRow {
    host_id: String,
    started_at: i64,
    status: String,
    error_message: Option<String>,
}

fn auth_type_to_str(auth_type: &AuthType) -> &'static str {
    match auth_type {
        AuthType::Password => "password",
        AuthType::PrivateKey => "private_key",
    }
}

fn parse_auth_type(value: &str) -> Result<AuthType, AppErrorDto> {
    match value {
        "password" => Ok(AuthType::Password),
        "private_key" => Ok(AuthType::PrivateKey),
        _ => Err(AppErrorDto::new(
            crate::contracts::AppErrorCode::HostInvalid,
            "Invalid auth type",
            false,
        )),
    }
}

fn parse_connection_status(value: &str) -> Result<ConnectionStatus, AppErrorDto> {
    match value {
        "connected" => Ok(ConnectionStatus::Connected),
        "disconnected" => Ok(ConnectionStatus::Disconnected),
        "failed" => Ok(ConnectionStatus::Failed),
        "auth_failed" => Ok(ConnectionStatus::AuthFailed),
        "timeout" => Ok(ConnectionStatus::Timeout),
        "network_error" => Ok(ConnectionStatus::NetworkError),
        _ => Err(AppErrorDto::new(
            crate::contracts::AppErrorCode::DatabaseError,
            "Invalid connection status stored in database",
            false,
        )),
    }
}
