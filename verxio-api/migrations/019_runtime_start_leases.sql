CREATE TABLE IF NOT EXISTS runtime_start_leases (
    lease_key TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_start_leases_expires
ON runtime_start_leases(expires_at);
