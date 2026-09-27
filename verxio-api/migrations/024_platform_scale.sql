-- Durable job receipts, tenant cron defs, channel credentials, dual-run flag.

CREATE TABLE IF NOT EXISTS platform_jobs (
    id TEXT PRIMARY KEY,
    stream TEXT NOT NULL,
    kind TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT '',
    workspace_id TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_jobs_stream_status
ON platform_jobs(stream, status, created_at);

CREATE TABLE IF NOT EXISTS tenant_cron_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT,
    last_run_at TEXT,
    source TEXT NOT NULL DEFAULT 'hermes',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workspace_id, agent_id, name)
);
CREATE INDEX IF NOT EXISTS idx_tenant_cron_due
ON tenant_cron_jobs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS channel_credentials (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    shard_key TEXT NOT NULL DEFAULT '',
    ciphertext TEXT NOT NULL,
    restored_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workspace_id, agent_id, platform)
);

CREATE TABLE IF NOT EXISTS runtime_plane_flags (
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    plane TEXT NOT NULL DEFAULT 'docker',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, agent_id)
);
