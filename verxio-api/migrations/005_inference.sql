CREATE TABLE IF NOT EXISTS user_inference_settings (
    user_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'hosted',
    default_model_id TEXT NOT NULL DEFAULT 'verxio-qwen',
    monthly_credit_usd REAL NOT NULL DEFAULT 0,
    overage_enabled INTEGER NOT NULL DEFAULT 0,
    spending_limit_usd REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    agent_id TEXT,
    runtime_id TEXT,
    session_id TEXT,
    turn_id TEXT,
    mode TEXT NOT NULL,
    verxio_model_id TEXT NOT NULL,
    provider_slug TEXT NOT NULL,
    upstream_model_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_provider_cost_usd REAL NOT NULL DEFAULT 0,
    billed_cost_usd REAL NOT NULL DEFAULT 0,
    cost_source TEXT NOT NULL DEFAULT 'catalog',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, session_id, turn_id, verxio_model_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_runtime ON usage_events(runtime_id, session_id);
