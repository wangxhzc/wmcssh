PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS host_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES host_groups(id)
);

CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  password_ref TEXT,
  private_key_path TEXT,
  private_key_ref TEXT,
  passphrase_ref TEXT,
  group_id TEXT,
  startup_command TEXT,
  terminal_theme TEXT,
  connect_timeout_ms INTEGER NOT NULL DEFAULT 10000,
  keepalive_interval_secs INTEGER NOT NULL DEFAULT 30,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES host_groups(id)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS host_tags (
  host_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (host_id, tag_id),
  FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recent_sessions (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  duration_seconds INTEGER,
  FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hosts_group_id ON hosts(group_id);
CREATE INDEX IF NOT EXISTS idx_hosts_hostname ON hosts(hostname);
CREATE INDEX IF NOT EXISTS idx_hosts_username ON hosts(username);
CREATE INDEX IF NOT EXISTS idx_hosts_name ON hosts(name);
CREATE INDEX IF NOT EXISTS idx_recent_sessions_host_id ON recent_sessions(host_id);
CREATE INDEX IF NOT EXISTS idx_recent_sessions_started_at ON recent_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_host_groups_parent_id ON host_groups(parent_id);
CREATE INDEX IF NOT EXISTS idx_host_tags_tag_id ON host_tags(tag_id);
