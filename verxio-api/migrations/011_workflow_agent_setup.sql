CREATE TABLE IF NOT EXISTS workflow_agent_setup_drafts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    runtime_agent_id TEXT NOT NULL,
    workflow_agent_id TEXT,
    source TEXT NOT NULL DEFAULT 'web',
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    draft_json TEXT NOT NULL DEFAULT '{}',
    approvals_required_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (runtime_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_agent_setup_approvals (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    runtime_agent_id TEXT NOT NULL,
    workflow_agent_id TEXT,
    setup_draft_id TEXT,
    risk_type TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (runtime_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE SET NULL,
    FOREIGN KEY (setup_draft_id) REFERENCES workflow_agent_setup_drafts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_setup_drafts_agent ON workflow_agent_setup_drafts(workspace_id, runtime_agent_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_workflow_setup_approvals_draft ON workflow_agent_setup_approvals(setup_draft_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_setup_approvals_agent ON workflow_agent_setup_approvals(workspace_id, runtime_agent_id, status);
