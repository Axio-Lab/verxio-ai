CREATE TABLE IF NOT EXISTS workflow_agents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    runtime_agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    skills_json TEXT NOT NULL DEFAULT '[]',
    knowledge_json TEXT NOT NULL DEFAULT '[]',
    tools_json TEXT NOT NULL DEFAULT '[]',
    integrations_json TEXT NOT NULL DEFAULT '[]',
    approval_policy TEXT NOT NULL DEFAULT 'default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (runtime_agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_triggers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    workflow_agent_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    event_name TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    secret TEXT NOT NULL DEFAULT '',
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    runtime_agent_id TEXT NOT NULL,
    workflow_agent_id TEXT NOT NULL,
    trigger_id TEXT,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    input_json TEXT NOT NULL DEFAULT '{}',
    output_text TEXT NOT NULL DEFAULT '',
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (runtime_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (trigger_id) REFERENCES workflow_triggers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_run_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    workflow_agent_id TEXT NOT NULL,
    workflow_run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_agents_workspace ON workflow_agents(workspace_id, runtime_agent_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_workflow_triggers_agent ON workflow_triggers(workspace_id, workflow_agent_id, enabled);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_agent ON workflow_runs(workspace_id, workflow_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run ON workflow_run_events(workflow_run_id, created_at);
