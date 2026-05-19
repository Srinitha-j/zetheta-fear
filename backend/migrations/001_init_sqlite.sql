-- SQLite baseline migration scaffold
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  password_salt TEXT NOT NULL,
  password_digest TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sentiment_snapshots (
  id TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  label TEXT NOT NULL,
  contrarian_signal TEXT NOT NULL,
  news INTEGER NOT NULL,
  social INTEGER NOT NULL,
  volatility INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_error TEXT
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  created_by_username TEXT
);

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  predicted_score INTEGER NOT NULL,
  predicted_label TEXT,
  status TEXT NOT NULL,
  actual_score INTEGER,
  actual_label TEXT,
  points INTEGER,
  scored_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_prediction_unique
ON predictions(user_id, challenge_id)
WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
