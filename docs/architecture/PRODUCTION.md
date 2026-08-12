# Production deploy — scale architecture

## Current production path (Alibaba ECS + Docker)

This is the **supported production path today**.

```bash
# On the ECS host
export DEPLOY_REF=verxio/architecture   # or merge to verxio/web / main first
bash scripts/deploy-ecs.sh
```

Deploy enables:
- `INSTALL_TURSO=1` + `INSTALL_SCALE=1` in the API image
- Idle reaper background loop (`VERXIO_IDLE_REAPER_ENABLED=true`)
- Wake/drain APIs + SQLite/Turso start leases (safe with uvicorn 2 workers)
- Hermes restart policy `no` (scale-to-zero friendly)
- Snapshots of `hermes-home` on drain (local under `.verxio/snapshots` by default)

### Required env (`.env` / compose)

```bash
VERXIO_RUNTIME_MANAGER=local-docker
VERXIO_RUNTIME_IDLE_ENABLED=true
VERXIO_RUNTIME_IDLE_POLICY=default   # or free|pro|business
VERXIO_IDLE_REAPER_ENABLED=true
VERXIO_IDLE_REAPER_INTERVAL_SECONDS=60
VERXIO_RUNTIME_RESTART_POLICY=no
VERXIO_RUNTIME_DOCKER_NETWORK=verxio-ai_default
# optional:
# VERXIO_REDIS_URL=redis://...
# VERXIO_ARTIFACT_STORE=s3
# VERXIO_ARTIFACT_S3_BUCKET=...
```

### Smoke after deploy

```bash
curl -fsS http://127.0.0.1:8787/api/health
# login, then:
# POST /api/runtime/wake
# POST /api/runtime/drain
# GET  /api/runtime/idle/policies
```

### Real docker CI locally

```bash
bash scripts/scale/runtime_docker_test.sh
```

## Optional: Fly runtime plane

1. `fly apps create verxio-runtimes`
2. Build/push Hermes image used as `VERXIO_FLY_HERMES_IMAGE`
3. Set on control plane:
   - `VERXIO_RUNTIME_MANAGER=fly`
   - `VERXIO_FLY_API_TOKEN=...`
   - `VERXIO_FLY_APP=verxio-runtimes`
4. Configs under `deploy/fly/`

## Optional: Kubernetes

1. Install API with `--extra k8s` / `INSTALL_SCALE=1`
2. `VERXIO_RUNTIME_MANAGER=k8s`
3. `VERXIO_K8S_ENABLED=true`
4. In-cluster SA or kubeconfig with create/delete Pod in `VERXIO_K8S_NAMESPACE`

## Rollback

Set `VERXIO_IDLE_REAPER_ENABLED=false` and `VERXIO_RUNTIME_RESTART_POLICY=unless-stopped` then redeploy if you need the old always-on behavior temporarily.
