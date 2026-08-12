# Verxio scale architecture

Branch: `verxio/architecture`

## Stack

| Layer | Choice |
|-------|--------|
| Local / CI | Docker Compose |
| Runtime backends | `local-docker` (default), `fly`, `k8s` (stub) |
| Control DB | Turso / SQLite |
| Leases | In-memory or `VERXIO_REDIS_URL` |
| Snapshots | Local FS or S3 (`VERXIO_ARTIFACT_STORE`) |

## Package

`verxio-api/app/runtime_orch/`:

- `states.py` — stopped/starting/running/draining/error
- `manager.py` — RuntimeManager protocol
- `local_docker.py` / `fly.py` / `k8s.py`
- `lifecycle.py` — wake / drain / idle reap
- `idle.py` — free/pro/business policies
- `leases.py` — start locks
- `artifacts_store.py` — hermes-home snapshots
- `wake_queue.py` — channel/cron wake FIFO
- `cells.py` — tenant cell routing stub

## API

- `POST /api/runtime/start` → wake (leased)
- `POST /api/runtime/wake`
- `POST /api/runtime/drain`
- `POST /api/runtime/idle/reap`
- `GET /api/runtime/idle/policies`

## Env

```bash
VERXIO_RUNTIME_MANAGER=local-docker|fly|k8s
VERXIO_RUNTIME_RESTART_POLICY=no          # was unless-stopped
VERXIO_RUNTIME_PUBLISH_PORTS=true|false   # prefer DNS when false
VERXIO_RUNTIME_IDLE_ENABLED=true
VERXIO_RUNTIME_IDLE_POLICY=default|free|pro|business|always_on
VERXIO_REDIS_URL=redis://...
VERXIO_ARTIFACT_STORE=local|s3
VERXIO_FLY_API_TOKEN=...
VERXIO_FLY_APP=verxio-runtimes
VERXIO_K8S_ENABLED=false
VERXIO_CELL_COUNT=1
```

## Phases shipped on this branch

1. Lifecycle state machine + idle/wake + restart policy `no`
2. RuntimeManager interface + LocalDocker
3. Redis leases (optional) + local/S3 artifact snapshots
4. FlyRuntimeManager (live API when token set)
5. Plan idle policies + wake queue
6. K8s manifest stub + cell routing

## Tests

```bash
cd verxio-api && uv run pytest tests/runtime_orch -v
# Real docker (image required):
bash scripts/scale/runtime_docker_test.sh
```
