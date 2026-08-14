ALTER TABLE workflow_agents ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE workflow_agents ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';
ALTER TABLE workflow_agents ADD COLUMN funnel_rules_json TEXT NOT NULL DEFAULT '{"rules":[]}';
ALTER TABLE workflow_agents ADD COLUMN fallback_email TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_agents ADD COLUMN campaign_context TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS workflow_agent_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    workflow_agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    suggest_rating INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE CASCADE,
    UNIQUE (workflow_agent_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS sdr_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    runtime_agent_id TEXT NOT NULL,
    workflow_agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'web',
    flow_state_json TEXT NOT NULL DEFAULT '{}',
    follow_up_next_fire_at TEXT,
    reply_channel TEXT NOT NULL DEFAULT '',
    reply_connection_id TEXT NOT NULL DEFAULT '',
    reply_conversation_id TEXT NOT NULL DEFAULT '',
    reply_sender_id TEXT NOT NULL DEFAULT '',
    reply_thread_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE CASCADE,
    UNIQUE (workflow_agent_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS sdr_contacts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    workflow_agent_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    sender_id TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT '',
    conversation_id TEXT NOT NULL DEFAULT '',
    connection_id TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_agent_id) REFERENCES workflow_agents(id) ON DELETE CASCADE,
    UNIQUE (workflow_agent_id, channel, sender_id)
);

CREATE INDEX IF NOT EXISTS idx_sdr_sessions_follow_up
ON sdr_sessions(follow_up_next_fire_at);
