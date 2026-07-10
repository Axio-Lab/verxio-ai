#!/usr/bin/env bash
# Deploy Verxio on ECS: pull main, rebuild services, refresh Hermes runtimes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.verxio.yml)

echo "==> Pulling main"
git fetch origin
git checkout main
git pull origin main
git submodule update --init --recursive

echo "==> Building verxio-api + verxio-web"
"${COMPOSE[@]}" build --build-arg INSTALL_TURSO=1 verxio-api verxio-web

echo "==> Building Hermes runtime image"
"${COMPOSE[@]}" --profile image build hermes-runtime-image

echo "==> Recreating control-plane services"
"${COMPOSE[@]}" up -d --force-recreate verxio-api verxio-web

echo "==> Removing per-user Hermes runtimes (they recreate on next use with the new image)"
# Compose services are named like verxio-ai-verxio-api-1 — leave those alone.
# User runtimes are named verxio-{workspace}-{agent}, e.g. verxio-ws_xxx-agent_yyy.
mapfile -t RUNTIME_NAMES < <(docker ps -a --format '{{.Names}}' | grep -E '^verxio-' | grep -vE '^verxio-ai-' || true)
if ((${#RUNTIME_NAMES[@]})); then
  printf '    removing: %s\n' "${RUNTIME_NAMES[@]}"
  docker rm -f "${RUNTIME_NAMES[@]}"
else
  echo "    none found"
fi

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
  echo "==> Reloading Caddy"
  systemctl reload caddy || true
fi

echo "==> Status"
"${COMPOSE[@]}" ps
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' | grep -E 'REPOSITORY|verxio' || true

echo
echo "Done. Open the app once so Verxio starts fresh Hermes runtimes from the new image."
