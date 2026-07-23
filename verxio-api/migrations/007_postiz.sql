CREATE TABLE IF NOT EXISTS postiz_workspaces (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    postiz_org_id TEXT NOT NULL DEFAULT '',
    postiz_user_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'disabled',
    credentials_encrypted TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workspace_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_postiz_workspaces_agent ON postiz_workspaces(workspace_id, agent_id);
