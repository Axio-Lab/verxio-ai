CREATE TABLE IF NOT EXISTS notepad_folders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notepad_notes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    folder_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    transcript TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    meeting_type TEXT NOT NULL DEFAULT 'general',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES notepad_folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notepad_shares (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    note_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (note_id) REFERENCES notepad_notes(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notepad_folders_agent ON notepad_folders(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_notepad_notes_agent ON notepad_notes(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_notepad_notes_folder ON notepad_notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notepad_shares_token ON notepad_shares(token);
CREATE INDEX IF NOT EXISTS idx_notepad_shares_note ON notepad_shares(note_id, revoked_at);
