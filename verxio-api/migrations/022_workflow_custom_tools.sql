CREATE TABLE IF NOT EXISTS workflow_custom_tools (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT 'POST',
    url TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'api_key',
    api_key_env TEXT NOT NULL DEFAULT '',
    headers_json TEXT NOT NULL DEFAULT '{}',
    request_schema_json TEXT NOT NULL DEFAULT '{}',
    response_hint TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_custom_tools_workspace
ON workflow_custom_tools(workspace_id, updated_at);
