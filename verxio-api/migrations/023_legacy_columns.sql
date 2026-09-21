-- Fold leftover runtime ALTERs from _ensure_legacy_columns into a numbered migration.
-- SQLite / Turso ignore ADD COLUMN when the column already exists via the
-- Python fallback; run_migrations still skips already-applied versions.

ALTER TABLE workflow_agents ADD COLUMN model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_agents ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE workflow_agents ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';
ALTER TABLE workflow_agents ADD COLUMN funnel_rules_json TEXT NOT NULL DEFAULT '{"rules":[]}';
ALTER TABLE workflow_agents ADD COLUMN fallback_email TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_agents ADD COLUMN campaign_context TEXT NOT NULL DEFAULT '';

ALTER TABLE workflow_triggers ADD COLUMN next_run_at TEXT;
ALTER TABLE workflow_triggers ADD COLUMN last_run_at TEXT;
ALTER TABLE workflow_triggers ADD COLUMN claim_token TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_triggers ADD COLUMN claimed_at TEXT;

ALTER TABLE runtime_instances ADD COLUMN last_activity_at TEXT;
ALTER TABLE runtime_instances ADD COLUMN idle_policy TEXT NOT NULL DEFAULT 'default';
ALTER TABLE runtime_instances ADD COLUMN cell_id TEXT NOT NULL DEFAULT 'cell_default';
ALTER TABLE runtime_instances ADD COLUMN manager TEXT;
ALTER TABLE runtime_instances ADD COLUMN external_ref TEXT;

ALTER TABLE micromgr_workers ADD COLUMN onboarding_sent_at TEXT;
