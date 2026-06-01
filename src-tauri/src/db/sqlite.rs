use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::str::FromStr;
use tauri::{AppHandle, Manager};

pub async fn init_sqlite(app: &AppHandle) -> anyhow::Result<SqlitePool> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| anyhow::anyhow!("failed to get app data dir: {err}"))?;

    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("wmcssh.sqlite");
    let database_url = format!("sqlite://{}", db_path.to_string_lossy());

    let options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;

    sqlx::query("PRAGMA journal_mode = WAL;")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA busy_timeout = 3000;")
        .execute(&pool)
        .await?;

    crate::db::migrations::run_migrations(&pool).await?;

    Ok(pool)
}
