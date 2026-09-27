-- Worker-pool plane: per-tenant runtime env, cron results.

CREATE TABLE IF NOT EXISTS tenant_runtime_env (
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, agent_id)
);

ALTER TABLE tenant_cron_jobs ADD COLUMN last_status TEXT NOT NULL DEFAULT '';
ALTER TABLE tenant_cron_jobs ADD COLUMN last_output TEXT NOT NULL DEFAULT '';
ALTER TABLE tenant_cron_jobs ADD COLUMN last_error TEXT;
