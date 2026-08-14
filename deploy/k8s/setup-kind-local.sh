#!/usr/bin/env bash
# Bootstrap local kind cluster for Verxio K8s runtime manager.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
CLUSTER_NAME="${VERXIO_KIND_CLUSTER:-verxio}"
NAMESPACE="${VERXIO_K8S_NAMESPACE:-verxio-runtimes}"
HERMES_IMAGE="${VERXIO_HERMES_IMAGE:-verxio-hermes-runtime:local}"
STATE_DIR="${VERXIO_STATE_DIR:-$ROOT/.verxio}"
KUBE_OUT="${STATE_DIR}/kubeconfig-kind"
RUNTIMES_HOST="${STATE_DIR}/runtimes"
NODE_MOUNT="/verxio-runtimes"

if ! command -v kind >/dev/null 2>&1; then
  echo "ERROR: kind is not installed"
  exit 1
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "ERROR: kubectl is not installed"
  exit 1
fi

mkdir -p "$RUNTIMES_HOST"

KIND_CFG="$(mktemp)"
trap 'rm -f "$KIND_CFG"' EXIT
cat > "$KIND_CFG" <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraMounts:
  - hostPath: ${RUNTIMES_HOST}
    containerPath: ${NODE_MOUNT}
EOF

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  if ! docker exec "${CLUSTER_NAME}-control-plane" test -d "$NODE_MOUNT" 2>/dev/null; then
    echo "==> Recreating kind cluster ${CLUSTER_NAME} with runtime hostPath mount"
    kind delete cluster --name "$CLUSTER_NAME"
  fi
fi

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "==> Creating kind cluster ${CLUSTER_NAME}"
  kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CFG"
fi

kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null

echo "==> Ensuring namespaces + RBAC"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace verxio-system --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$ROOT/deploy/k8s/rbac.yaml"

mkdir -p "$(dirname "$KUBE_OUT")"
# API container joins the kind Docker network and reaches the control-plane by name.
kind get kubeconfig --name "$CLUSTER_NAME" \
  | sed 's|server: https://127.0.0.1:[0-9]*|server: https://verxio-control-plane:6443|' \
  > "$KUBE_OUT"
chmod 600 "$KUBE_OUT"
echo "    wrote docker-friendly kubeconfig -> ${KUBE_OUT}"

if docker image inspect "$HERMES_IMAGE" >/dev/null 2>&1; then
  echo "==> Loading ${HERMES_IMAGE} into kind"
  kind load docker-image "$HERMES_IMAGE" --name "$CLUSTER_NAME"
else
  echo "WARN: image ${HERMES_IMAGE} not found locally — build it before waking runtimes"
fi

echo "==> Ready"
kubectl get ns "$NAMESPACE" verxio-system
kubectl get nodes
echo
echo "Set in .env (or export) then recreate verxio-api:"
echo "  VERXIO_RUNTIME_MANAGER=k8s"
echo "  VERXIO_K8S_ENABLED=true"
echo "  VERXIO_K8S_NAMESPACE=${NAMESPACE}"
echo "  VERXIO_K8S_CONNECT_MODE=hostPort"
echo "  VERXIO_K8S_NODE_HOST=verxio-control-plane"
echo "  VERXIO_K8S_HOST_PATH_ROOT=${NODE_MOUNT}"
echo "  VERXIO_HERMES_IMAGE=${HERMES_IMAGE}"
echo "  VERXIO_KUBECONFIG_HOST=${KUBE_OUT}"
echo
echo "  bash scripts/verxio-up.sh"
echo "  bash scripts/verxio-down.sh"
