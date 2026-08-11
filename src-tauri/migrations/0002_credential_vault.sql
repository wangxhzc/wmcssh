CREATE TABLE IF NOT EXISTS credential_vault (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  salt BLOB NOT NULL,
  memory_cost_kib INTEGER NOT NULL,
  iterations INTEGER NOT NULL,
  parallelism INTEGER NOT NULL,
  verification_nonce BLOB NOT NULL,
  verification_ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS encrypted_secrets (
  secret_ref TEXT PRIMARY KEY,
  nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
