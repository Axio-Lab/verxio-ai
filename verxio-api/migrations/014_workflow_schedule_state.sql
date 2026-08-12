ALTER TABLE workflow_triggers ADD COLUMN next_run_at TEXT;
ALTER TABLE workflow_triggers ADD COLUMN last_run_at TEXT;
ALTER TABLE workflow_triggers ADD COLUMN claim_token TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_triggers ADD COLUMN claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_workflow_triggers_schedule_due
ON workflow_triggers(trigger_type, enabled, next_run_at);
