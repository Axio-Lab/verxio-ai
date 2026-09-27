-- Desktop cloud brokering: device tokens for the Verxio Desktop app and the
-- per-account agent state store shared by the desktop Hermes and the cloud agent.

CREATE TABLE IF NOT EXISTS device_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    last_used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

CREATE TABLE IF NOT EXISTS agent_state_files (
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    etag TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT 'desktop',
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    content BLOB,
    PRIMARY KEY (user_id, path),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_state_files_expires ON agent_state_files(expires_at);
