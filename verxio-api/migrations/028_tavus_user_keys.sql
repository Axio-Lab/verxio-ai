CREATE TABLE IF NOT EXISTS tavus_user_accounts (
    user_id TEXT PRIMARY KEY,
    api_key_ciphertext TEXT NOT NULL DEFAULT '',
    tool_id TEXT NOT NULL DEFAULT '',
    guardrail_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
