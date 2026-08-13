#!/usr/bin/env bash
# Tear down the local k8s stack: Compose project + kind cluster + leftover runtimes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

COMPOSE=(docker compose -f docker-compose.verxio.yml -f docker-compose.kind.yml)
CLUSTER_NAME="${VERXIO_KIND_CLUSTER:-verxio}"

echo "==> Compose down"
"${COMPOSE[@]}" down --remove-orphans --timeout 20 || \
  docker compose -f docker-compose.verxio.yml down --remove-orphans --timeout 20 || true

echo "==> Removing leftover Docker runtimes"
docker ps -aq --filter name=verxio-ws- | while read -r id; do
  docker rm -f "$id" >/dev/null
done

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "==> Deleting kind cluster ${CLUSTER_NAME}"
  kind delete cluster --name "$CLUSTER_NAME"
fi

echo "==> Clean"
docker ps -a --format '{{.Names}} {{.Status}}' | grep -E 'verxio|kind' || echo "(no verxio/kind containers)"
