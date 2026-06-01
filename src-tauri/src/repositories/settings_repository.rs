use crate::contracts::AppErrorDto;
use sqlx::SqlitePool;
use std::collections::HashMap;

pub struct SettingsRepository {
    pool: SqlitePool,
}

impl SettingsRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_values(&self) -> Result<HashMap<String, String>, AppErrorDto> {
        let rows = sqlx::query_as::<_, SettingRow>("SELECT key, value FROM settings")
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.into_iter().map(|row| (row.key, row.value)).collect())
    }

    pub async fn set_value(&self, key: &str, value: &str) -> Result<(), AppErrorDto> {
        sqlx::query(
            r#"
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, strftime('%s', 'now') * 1000)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn delete_value(&self, key: &str) -> Result<(), AppErrorDto> {
        sqlx::query("DELETE FROM settings WHERE key = ?")
            .bind(key)
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct SettingRow {
    key: String,
    value: String,
}
