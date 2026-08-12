#!/usr/bin/env bash
# Bootstrap local kind cluster for Verxio K8s runtime manager.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
CLUSTER_NAME="${VERXIO_KIND_CLUSTER:-verxio}"
NAMESPACE="${VERXIO_K8S_NAMESPACE:-verxio-runtimes}"
HERMES_IMAGE="${VERXIO_HERMES_IMAGE:-verxio-hermes-runtime:local}"
KUBE_OUT="${VERXIO_STATE_DIR:-$ROOT/.verxio}/kubeconfig-kind"

if ! command -v kind >/dev/null 2>&1; then
  echo "ERROR: kind is not installed"
  exit 1
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "ERROR: kubectl is not installed"
  exit 1
fi

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "==> Creating kind cluster ${CLUSTER_NAME}"
  kind create cluster --name "$CLUSTER_NAME"
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
echo "  VERXIO_HERMES_IMAGE=${HERMES_IMAGE}"
echo "  VERXIO_KUBECONFIG_HOST=${KUBE_OUT}"
echo
echo "  docker compose -f docker-compose.verxio.yml up -d --force-recreate verxio-api"
