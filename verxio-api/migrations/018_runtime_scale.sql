-- Scale architecture: activity tracking, idle policy, cell routing, manager metadata.
ALTER TABLE runtime_instances ADD COLUMN last_activity_at TEXT;
ALTER TABLE runtime_instances ADD COLUMN idle_policy TEXT NOT NULL DEFAULT 'default';
ALTER TABLE runtime_instances ADD COLUMN cell_id TEXT NOT NULL DEFAULT 'cell_default';
ALTER TABLE runtime_instances ADD COLUMN manager TEXT;
ALTER TABLE runtime_instances ADD COLUMN external_ref TEXT;
