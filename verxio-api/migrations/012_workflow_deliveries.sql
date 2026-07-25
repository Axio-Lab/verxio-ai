CREATE TABLE IF NOT EXISTS workflow_deliveries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    workflow_agent_id TEXT NOT NULL,
    delivery_type TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT '',
    destination TEXT NOT NULL DEFAULT '',
    template TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    require_approval INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_deliveries_agent
    ON workflow_deliveries(workspace_id, workflow_agent_id, enabled);
