-- Fold leftover runtime ALTERs from _ensure_legacy_columns into a numbered migration.
-- SQLite / Turso ignore ADD COLUMN when the column already exists via the
-- Python fallback; run_migrations still skips already-applied versions.

ALTER TABLE runtime_instances ADD COLUMN last_activity_at TEXT;
ALTER TABLE runtime_instances ADD COLUMN idle_policy TEXT NOT NULL DEFAULT 'default';
ALTER TABLE runtime_instances ADD COLUMN cell_id TEXT NOT NULL DEFAULT 'cell_default';
ALTER TABLE runtime_instances ADD COLUMN manager TEXT;
ALTER TABLE runtime_instances ADD COLUMN external_ref TEXT;
