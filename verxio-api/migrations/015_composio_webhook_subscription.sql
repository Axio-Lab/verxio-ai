CREATE TABLE IF NOT EXISTS composio_webhook_subscription (
    id TEXT PRIMARY KEY,
    webhook_url TEXT NOT NULL,
    secret TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT 'V3',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS composio_webhook_receipts (
    webhook_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL,
    completed_at TEXT
);
