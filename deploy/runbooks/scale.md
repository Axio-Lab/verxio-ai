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

Workers call `restore_home` on attach when the local directory is empty.
Snapshots keep only memory, skills, soul, agent config, and `outputs/`.

## Images and rollout

`.github/workflows/images.yml` builds and pushes `ghcr.io/<org>/verxio-{api,web,landing,hermes-base,hermes}`
tagged `sha-<12>` on every push to `main`/`verxio/scale`. The API image has no
docker CLI; `hermes-base` is built with `HERMES_INSTALL_BROWSER=0`
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
- Every Hermes container (worker sidecar and channel shards) runs the
  startup/readiness/liveness trio on `/api/healthz` (`hermesProbes.*`) plus the in-image
  `dashboard-watchdog` s6 service, and the scheduler's runtime watchdog restarts the
  dashboard service (then the compute) after `VERXIO_RUNTIME_WATCHDOG_FAILURES` failed probes.
- `monitoring.enabled` adds a ServiceMonitor for `/metrics` on the API and a PrometheusRule
  with the health-fail-rate and proxy-latency SLO alerts.

### Production checklist

1. Managed Redis: `redis.enabled=false`, `redis.url=rediss://…`, `autoscaling.worker.keda.address`
   + `enableTLS=true`. The in-cluster StatefulSet is single-node.
2. Sandbox tier: `sandbox.dockerHost` + `sandbox.tlsSecret` on every cluster. Pool workers
   fail closed without it.
3. Database: Turso with the bounded API pool (`VERXIO_DB_POOL_SIZE`, default 16 per replica).
   Moving to Postgres is a separate migration and is not covered by the chart.
4. `monitoring.enabled=true` once kube-prometheus-stack is installed.

## Cloud agent

The only plane is pool. `app.plane set` rejects docker and Kubernetes. Cron,
messaging, and workflow agents run on the pool workers; interactive chat runs
in the desktop app.
