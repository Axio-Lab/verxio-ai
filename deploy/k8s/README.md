# Local Kubernetes (kind) for Verxio runtimes

Local and production both use `VERXIO_RUNTIME_MANAGER=k8s`. Kind is the local cluster;
Compose only runs web + API. Hermes runtimes are pods, not extra Compose containers.

## Up / down (keeps Docker clean)

```bash
bash scripts/verxio-up.sh    # kind + compose overlay + wake runtime
bash scripts/verxio-down.sh  # compose down + delete kind + remove leftover runtimes
```

`verxio-up.sh` stops any `verxio-ws-*` Docker containers first so they cannot share
`hermes-home` with the kind pod.

What you should see in Docker Desktop after up:

- Compose project `verxio-ai`: `verxio-api-1`, `verxio-web-1`
- Kind node: `verxio-control-plane` (Kubernetes control plane — this is a Docker container)
- **No** `verxio-ws-*` Docker container. The agent is a pod inside kind:

```bash
kubectl --context kind-verxio -n verxio-runtimes get pods
```

Docker Desktop’s **Kubernetes** sidebar is Docker’s own cluster. Ignore it. Verxio uses **kind**, shown as `verxio-control-plane`.

## What the up script does

1. `deploy/k8s/setup-kind-local.sh` — cluster `verxio`, namespaces, RBAC, hostPath
   mount of `.verxio/runtimes` → `/verxio-runtimes`, kubeconfig, `kind load` of
   `verxio-hermes-runtime:local`
2. `docker compose -f docker-compose.verxio.yml -f docker-compose.kind.yml up`
3. Wake the workspace runtime as a Pod

`.env` for this machine:

```bash
VERXIO_RUNTIME_MANAGER=k8s
VERXIO_K8S_ENABLED=true
VERXIO_K8S_NAMESPACE=verxio-runtimes
VERXIO_K8S_CONNECT_MODE=hostPort
VERXIO_K8S_NODE_HOST=verxio-control-plane
VERXIO_K8S_HOST_PATH_ROOT=/verxio-runtimes
VERXIO_HERMES_IMAGE=verxio-hermes-runtime:local
```

API image needs the Kubernetes client (`--build-arg INSTALL_SCALE=1` if you rebuild):

```bash
docker compose -f docker-compose.verxio.yml -f docker-compose.kind.yml build --build-arg INSTALL_SCALE=1 verxio-api
```

Messaging webhooks (`POST /api/hooks/{workspace_id}/{route}`) hit **verxio-api**, which wakes the user runtime and forwards to the runtime webhook port on the cluster-internal Service (`8644`). Do not publish that port to the public internet.

## Local vs production

| | Local (kind) | Production cluster |
|--|--------------|--------------------|
| Cluster | kind `verxio` | ACK / EKS / GKE (separate) |
| `VERXIO_K8S_CONNECT_MODE` | `hostPort` | `cluster` |
| Persistence | hostPath via kind extraMounts | PVC + snapshots |
| Image | `:local` (`kind load`) | private registry + pull secrets |
| API placement | Docker Compose + kind network | in-cluster (preferred) |
