CREATE TABLE IF NOT EXISTS pulse_channels (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    credentials_encrypted TEXT NOT NULL DEFAULT '',
    webhook_secret TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workspace_id, agent_id, channel_type, external_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_contacts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    username TEXT,
    display_name TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    consent_state TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (channel_id, external_user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES pulse_channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_conversations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'automated',
    window_expires_at TEXT,
    last_inbound_at TEXT,
    last_outbound_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (channel_id, contact_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES pulse_channels(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES pulse_contacts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    media_json TEXT NOT NULL DEFAULT '[]',
    provider_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES pulse_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_automations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    flow_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    automation_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    cursor_node_id TEXT,
    wait_until TEXT,
    context_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (automation_id) REFERENCES pulse_automations(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES pulse_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_tags (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'primary',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workspace_id, agent_id, name),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_contact_tags (
    contact_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (contact_id, tag_id),
    FOREIGN KEY (contact_id) REFERENCES pulse_contacts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES pulse_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pulse_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    workspace_id TEXT,
    agent_id TEXT,
    channel_id TEXT,
    channel_type TEXT NOT NULL,
    provider_event_id TEXT,
    signature_ok INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
    FOREIGN KEY (channel_id) REFERENCES pulse_channels(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pulse_channels_agent ON pulse_channels(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_pulse_channels_external ON pulse_channels(channel_type, external_id);
CREATE INDEX IF NOT EXISTS idx_pulse_contacts_channel ON pulse_contacts(channel_id, external_user_id);
CREATE INDEX IF NOT EXISTS idx_pulse_conversations_agent ON pulse_conversations(workspace_id, agent_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_pulse_messages_conversation ON pulse_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pulse_automations_agent ON pulse_automations(workspace_id, agent_id, enabled);
CREATE INDEX IF NOT EXISTS idx_pulse_runs_wait ON pulse_runs(status, wait_until);
CREATE INDEX IF NOT EXISTS idx_pulse_events_channel ON pulse_events(channel_type, channel_id, created_at);
