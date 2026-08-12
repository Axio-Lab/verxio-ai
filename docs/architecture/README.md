# Verxio scale architecture

**Production status:** ECS + `local-docker` path is deployable end-to-end.  
See [PRODUCTION.md](./PRODUCTION.md).

## Stack

| Layer | Production default | Optional |
|-------|--------------------|----------|
| Control plane | Docker Compose on ECS | Fly (`deploy/fly/verxio-api.fly.toml`) |
| Runtime backend | `local-docker` | `fly`, `k8s` |
| Leases | SQLite/Turso table (multi-worker safe) | Redis |
| Snapshots | Local `.verxio/snapshots` | S3/R2 |
| Idle | Background reaper in API lifespan | — |

## Package

`verxio-api/app/runtime_orch/`:

- Lifecycle wake/drain + checkpoint restore
- Background idle reaper + wake queue worker
- Managers: LocalDocker, Fly (Machines API), K8s (live apply when enabled)
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
