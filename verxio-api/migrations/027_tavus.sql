-- Per-user Tavus presence: one PAL, calls, tasks handed to Hermes, and training assets.

CREATE TABLE IF NOT EXISTS tavus_account (
    id TEXT PRIMARY KEY,
    tool_id TEXT,
    guardrail_id TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tavus_profiles (
    user_id TEXT PRIMARY KEY,
    pal_id TEXT,
    share_pal_id TEXT,
    face_id TEXT,
    voice_id TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    never_do TEXT NOT NULL DEFAULT '',
    spoken_prompt TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'en',
    region TEXT NOT NULL DEFAULT '',
    conferencing_username TEXT NOT NULL DEFAULT '',
    meeting_allowlist TEXT NOT NULL DEFAULT '[]',
    deployment_id TEXT,
    share_url TEXT NOT NULL DEFAULT '',
    pronunciation_dictionary_id TEXT,
    consent_face_at TEXT,
    consent_voice_at TEXT,
    monthly_minute_budget INTEGER NOT NULL DEFAULT 60,
    minutes_used INTEGER NOT NULL DEFAULT 0,
    minutes_period TEXT NOT NULL DEFAULT '',
    internet_search INTEGER NOT NULL DEFAULT 0,
    magic_canvas INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tavus_conversations (
    conversation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'app',
    status TEXT NOT NULL DEFAULT 'active',
    callback_token_hash TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    minutes_used INTEGER NOT NULL DEFAULT 0,
    transcript_json TEXT NOT NULL DEFAULT '[]',
    perception_summary TEXT NOT NULL DEFAULT '',
    notepad_note_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tavus_conversations_user ON tavus_conversations(user_id, created_at);

CREATE TABLE IF NOT EXISTS tavus_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    tool_call_id TEXT NOT NULL UNIQUE,
    instruction TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    hermes_session_id TEXT NOT NULL DEFAULT '',
    result_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tavus_tasks_pending ON tavus_tasks(user_id, status, created_at);

CREATE TABLE IF NOT EXISTS tavus_assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    tavus_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'started',
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, kind, tavus_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tavus_files (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tavus_pinned_facts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    memory_id TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
