# Production deploy — scale architecture

## Target: Kubernetes (separate local + prod clusters)

| | Local | Production |
|--|--------|------------|
| Cluster | kind (`verxio`) | ACK / EKS / GKE |
| Manager | `VERXIO_RUNTIME_MANAGER=k8s` | same |
| Connect | `hostPort` | `cluster` (API in-cluster) |
| State | hostPath via kind mount | PVC + snapshots |
| Image | `verxio-hermes-runtime:local` | private registry |

Local setup: `bash deploy/k8s/setup-kind-local.sh` — see `deploy/k8s/README.md`.

### Local `.env`

```bash
VERXIO_RUNTIME_MANAGER=k8s
VERXIO_K8S_ENABLED=true
VERXIO_K8S_NAMESPACE=verxio-runtimes
VERXIO_K8S_CONNECT_MODE=hostPort
VERXIO_K8S_NODE_HOST=verxio-control-plane
VERXIO_K8S_HOST_PATH_ROOT=/verxio-runtimes
VERXIO_HERMES_IMAGE=verxio-hermes-runtime:local
```

Compose API + kind pods **cannot** use pod IP / ClusterIP DNS from outside the CNI —
`hostPort` bridges via the kind node. Hermes gets `HERMES_DASHBOARD_SESSION_TOKEN`
injected automatically.

### Production cluster checklist

1. Install API with `--extra k8s` / `INSTALL_SCALE=1`
2. `VERXIO_RUNTIME_MANAGER=k8s`
3. `VERXIO_K8S_ENABLED=true`
4. `VERXIO_K8S_CONNECT_MODE=cluster` (Service DNS)
5. Run API **in-cluster** (or otherwise on the pod network)
6. In-cluster SA with create/delete Pod+Service in `VERXIO_K8S_NAMESPACE`
7. Persist hermes-home via PVC / snapshot restore
8. Private registry + `imagePullSecrets` (not `:local` images)

## Interim: Alibaba ECS + local-docker

Until the managed K8s cutover ships, ECS can keep using Docker:

```bash
export DEPLOY_REF=verxio/architecture
bash scripts/deploy-ecs.sh
```

```bash
VERXIO_RUNTIME_MANAGER=local-docker
VERXIO_RUNTIME_IDLE_ENABLED=true
VERXIO_RUNTIME_IDLE_POLICY=default
VERXIO_IDLE_REAPER_ENABLED=true
VERXIO_IDLE_REAPER_INTERVAL_SECONDS=60
VERXIO_RUNTIME_RESTART_POLICY=no
VERXIO_RUNTIME_DOCKER_NETWORK=verxio-ai_default
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

## Rollback

Set `VERXIO_IDLE_REAPER_ENABLED=false` and `VERXIO_RUNTIME_RESTART_POLICY=unless-stopped` then redeploy if you need the old always-on behavior temporarily.
