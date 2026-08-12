# Phase completion (production)

| Phase | Production-ready? | Notes |
|-------|-------------------|-------|
| 1 Lifecycle | **Yes** | wake/drain, background idle reaper, restart `no` |
| 2 RuntimeManager | **Yes** | LocalDocker is default prod backend on ECS |
| 3 Leases + snapshots | **Yes** | SQLite/Turso leases (multi-worker); local/S3 snapshots |
| 4 Fly | **Yes (ops)** | Code complete; set Fly token + app to cut over |
| 5 Policies + wake queue | **Yes** | Reaper + queue worker in API lifespan; messaging enqueues wake |
| 6 K8s + cells | **Yes (ops)** | Live create/delete when `VERXIO_K8S_ENABLED=true` |

Deploy: [PRODUCTION.md](./PRODUCTION.md)
