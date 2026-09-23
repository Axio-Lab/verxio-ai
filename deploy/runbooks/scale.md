# Scale runbooks

## Lease stuck

A tenant lease in Redis (`verxio:lease:tenant:{workspace}:{agent}`) blocks another worker.

1. `GET` the key. If the holder worker is gone, `DEL` the key.
2. The next turn re-acquires the lease and restores the home from object storage if the local copy is missing.

## Channel shard loss

Socket channels (WhatsApp Baileys, Discord) are sticky by `shard_for(workspace, agent)`.

1. Mark the shard unschedulable.
2. `drain_plan(lost_shard)` lists the remaining shards.
3. Restart the shard. Credentials reload from `channel_credentials` (encrypted in Turso).
4. Users re-pair only if the Baileys session file was not restored.

## Object storage restore

`python -m app.migrate_homes` uploads existing `.verxio/runtimes/.../hermes-home` trees.
Workers call `restore_home` on attach when the local directory is empty.
Snapshots exclude `cache/`, `audio_cache/`, `config.yaml.bak-*`, and cloned audit repos.

## Images and rollout

`.github/workflows/images.yml` builds and pushes `ghcr.io/<org>/verxio-{api,web,landing,hermes-base,hermes}`
tagged `sha-<12>` on every push to `main`/`verxio/scale`. The API is built with
`WITH_DOCKER_CLI=` (no docker binary); `hermes-base` is built with `HERMES_INSTALL_BROWSER=0`
and `hermes` layers `Dockerfile.verxio-hosted` on it. The `staging` job (GitHub environment
`staging`, secret `STAGING_KUBECONFIG`) runs `python -m app.migrate` as a Job, then
`helm upgrade --install verxio deploy/helm/verxio -f values-staging.yaml` and smokes `/api/health`.

Chart topology:

- `verxio-agent-worker` scales on queue depth with KEDA (`autoscaling.worker.keda.enabled`,
  `redis-streams` trigger on pending entries of `verxio:turns` / group `workers`); with KEDA
  disabled it falls back to a CPU HPA.
- `verxio-channel-gateway` is a StatefulSet; each pod's shard ordinal comes from
  `VERXIO_POD_NAME`, `channelGateway.shards` must match `VERXIO_CHANNEL_SHARDS` on the API,
  and the API reaches shards at `verxio-channel-gateway-{i}.verxio-channel-gateway:9119`.
- `redis.enabled` deploys a single AOF Redis StatefulSet; set it to `false` and point
  `redis.url` (and `autoscaling.worker.keda.address`) at a managed instance in production.
- All app pods `envFrom` the `secrets.name` Secret (Turso, `VERXIO_SECRETS_KEY`,
  `VERXIO_POOL_DASHBOARD_TOKEN`, SMTP).
- `verxio-api` and `verxio-web` have CPU HPAs (`autoscaling.api`, `autoscaling.web`);
  every tier has requests/limits (`resources.*`), a PodDisruptionBudget
  (`podDisruptionBudget.*`) and node/zone `topologySpreadConstraints`
  (`topologySpread.*`). KEDA is the default worker scaler.
- Every Hermes container (worker sidecar, channel shards, per-tenant k8s pods) runs the
  startup/readiness/liveness trio on `/api/healthz` (`hermesProbes.*`) plus the in-image
  `dashboard-watchdog` s6 service, and the scheduler's runtime watchdog restarts the
  dashboard service (then the compute) after `VERXIO_RUNTIME_WATCHDOG_FAILURES` failed probes.
- `monitoring.enabled` adds a ServiceMonitor for `/metrics` on the API and a PrometheusRule
  with the health-fail-rate and proxy-latency SLO alerts.

### Production checklist

1. Managed Redis: `redis.enabled=false`, `redis.url=rediss://…`, `autoscaling.worker.keda.address`
   + `enableTLS=true`. The in-cluster StatefulSet is single-node.
2. Sandbox tier: `sandbox.dockerHost` + `sandbox.tlsSecret` on every cluster. Pool workers
   fail closed without it; only the legacy per-tenant planes fall back to in-container
   low-priority tools (`VERXIO_SANDBOX_FALLBACK_LOCAL`).
3. Database: Turso with the bounded API pool (`VERXIO_DB_POOL_SIZE`, default 16 per replica).
   Moving to Postgres is a separate migration and is not covered by the chart.
4. `monitoring.enabled=true` once kube-prometheus-stack is installed.

## Cutover (dual-run)

`VERXIO_RUNTIME_MANAGER` is only the default plane. Every (workspace, agent) can be
flagged individually in `runtime_plane_flags`; the factory, wake queue, dashboard/WS
routing, artifacts, webhooks and workflow runs all resolve the tenant's plane
(`app.plane.resolve_plane`, cached 15s).

    python -m app.plane get  <workspace_id> <agent_id>
    python -m app.plane set  <workspace_id> <agent_id> pool     # move one tenant
    python -m app.plane list --plane pool
    python -m app.plane migrate-all pool                        # everyone without a row

A live runtime keeps the backend that started it until it stops; stop it
(`POST /api/runtime/stop`) after flipping the flag to re-home it immediately.

1. Deploy `python -m app.scheduler` and `python -m app.worker.runner` with
   `VERXIO_INLINE_SCHEDULER=0`, `VERXIO_WEBHOOK_INLINE=0` while the API default stays `local-docker`.
2. Flip internal tenants with `app.plane set ... pool`, soak, then `migrate-all pool`.
3. Set `VERXIO_RUNTIME_MANAGER=pool` so new tenants default to the pool.
4. `scripts/deploy-ecs.sh` skips the per-user container wipe when the manager is `pool`.

Roll back a tenant with `app.plane set <ws> <agent> docker`.

### Deleting the legacy planes (after the staging soak)

The soak gate is `python -m app.plane legacy-usage` (exit 0 = nothing flagged,
defaulting, or live on docker/k8s; `deploy-ecs.sh` prints it on every pool deploy).

1. Set `VERXIO_LEGACY_PLANES=0` and `VERXIO_DOCKER_SOCK=/dev/null` on the API and
   scheduler. The factory now raises `LegacyPlaneDisabled` for any docker/k8s request
   and `app.plane set` refuses non-pool planes. Run one more soak with this on.
2. Build the API image with `--build-arg WITH_DOCKER_CLI=0` (no `docker` binary).
3. Delete in one PR: `verxio-api/app/runtime_orch/local_docker.py`,
   `verxio-api/app/runtime_orch/k8s.py`, the docker inspect/network helpers in
   `verxio-api/app/runtime_manager.py`, the `docker_cli` stage in `verxio-api/Dockerfile`,
   the `VERXIO_DOCKER_SOCK` volume and `docker-compose.kind.yml`, the legacy wipe branch in
   `scripts/deploy-ecs.sh`, and the `docker`/`k8s` aliases in `app/plane.py` / `factory.py`.
4. Drop the `hermes_home_path`-based restore fallback in `app/homes.py` once
   `python -m app.migrate_homes` has uploaded every legacy home.
