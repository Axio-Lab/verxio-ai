# Verxio scale architecture

**Target runtime plane:** Kubernetes (kind locally, managed cluster in production).  
`local-docker` remains a fallback for ECS until the K8s cutover is complete.  
See [PRODUCTION.md](./PRODUCTION.md).

## Stack

| Layer | Target | Fallback |
|-------|--------|----------|
| Control plane | Compose (local) / in-cluster (prod) | ECS Compose |
| Runtime backend | `k8s` | `local-docker` |
| Leases | SQLite/Turso table (multi-worker safe) | Redis |
| Snapshots | Local `.verxio/snapshots` | S3/R2 |
| Idle | Background reaper in API lifespan | — |

## Package

`verxio-api/app/runtime_orch/`:

- Lifecycle wake/drain + checkpoint restore
- Background idle reaper + wake queue worker
- Managers: K8s (primary), LocalDocker (fallback)
- Cells, idle policies, artifact store

## API

- `POST /api/runtime/start` → wake
- `POST /api/runtime/wake`
- `POST /api/runtime/drain`
- `POST /api/runtime/idle/reap`
- `GET /api/runtime/idle/policies`

## Tests

```bash
cd verxio-api && uv run pytest tests/runtime_orch -v
bash scripts/scale/runtime_docker_test.sh   # real docker image required
```
