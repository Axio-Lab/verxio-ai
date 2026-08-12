# Local Kubernetes (kind) for Verxio runtimes

## One-shot setup

```bash
bash deploy/k8s/setup-kind-local.sh
```

This creates/uses kind cluster `verxio`, namespaces `verxio-runtimes` + `verxio-system`,
applies RBAC, mounts host `.verxio/runtimes` into the kind node at `/verxio-runtimes`,
writes `.verxio/kubeconfig-kind` (API-container friendly), and loads
`verxio-hermes-runtime:local` into kind.

If an older cluster lacks the runtime mount, the script recreates it.

## Point Verxio at K8s

In project `.env`:

```bash
VERXIO_RUNTIME_MANAGER=k8s
VERXIO_K8S_ENABLED=true
VERXIO_K8S_NAMESPACE=verxio-runtimes
VERXIO_K8S_CONNECT_MODE=hostPort
VERXIO_K8S_NODE_HOST=verxio-control-plane
VERXIO_K8S_HOST_PATH_ROOT=/verxio-runtimes
VERXIO_HERMES_IMAGE=verxio-hermes-runtime:local
```

Recreate API (needs `INSTALL_SCALE=1` image with kubernetes client):

```bash
docker compose -f docker-compose.verxio.yml build --build-arg INSTALL_SCALE=1 verxio-api
docker compose -f docker-compose.verxio.yml up -d --force-recreate verxio-api
```

Then `POST /api/runtime/wake` and:

```bash
kubectl -n verxio-runtimes get pods
```

## Local vs production

| | Local (kind) | Production cluster |
|--|--------------|--------------------|
| Cluster | kind `verxio` | ACK / EKS / GKE (separate) |
| `VERXIO_K8S_CONNECT_MODE` | `hostPort` | `cluster` |
| Persistence | hostPath via kind extraMounts | PVC + snapshots |
| Image | `:local` (`kind load`) | private registry + pull secrets |
| API placement | Docker Compose + kind network | in-cluster (preferred) |
