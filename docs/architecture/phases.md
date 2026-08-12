# Phase completion (production)

| Phase | Production-ready? | Notes |
|-------|-------------------|-------|
| 1 Lifecycle | **Yes** | wake/drain, background idle reaper, restart `no` |
| 2 RuntimeManager | **Yes** | K8s primary; LocalDocker ECS fallback |
| 3 Leases + snapshots | **Yes** | SQLite/Turso leases (multi-worker); local/S3 snapshots |
| 4 ~~Fly~~ | **Removed** | K8s-only scale path |
| 5 Policies + wake queue | **Yes** | Reaper + queue worker in API lifespan; messaging enqueues wake |
| 6 K8s + cells | **In progress** | kind local + hostPath; prod needs in-cluster API + PVC |

Deploy: [PRODUCTION.md](./PRODUCTION.md)
