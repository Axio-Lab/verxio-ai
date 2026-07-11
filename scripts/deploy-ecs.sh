#!/usr/bin/env bash
# Deploy Verxio on ECS: pull main, rebuild services + Hermes runtime image,
# recreate control plane, and wipe per-user runtimes so they boot on the new image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Hermes Dockerfile uses COPY --chmod=… which requires BuildKit. Without this,
# ECS hosts on the legacy builder abort mid-deploy and never recreate api/web.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

COMPOSE=(docker compose -f docker-compose.verxio.yml)
HERMES_IMAGE="${VERXIO_HERMES_IMAGE:-verxio-hermes-runtime:local}"
DEPLOY_REF="${DEPLOY_REF:-main}"

image_id() {
  docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || echo "(missing)"
}

echo "==> Pulling ${DEPLOY_REF}"
git fetch origin
git checkout "${DEPLOY_REF}"
git pull origin "${DEPLOY_REF}"
git submodule update --init --recursive

if [[ -n "$(git -C hermes-agent status --porcelain 2>/dev/null || true)" ]]; then
  echo "ERROR: hermes-agent submodule has local modifications after checkout."
  echo "       Commit/push those changes (and update the parent pointer) before deploying,"
  echo "       or they will not be baked into ${HERMES_IMAGE}."
  git -C hermes-agent status --short
  exit 1
fi

HERMES_SHA="$(git -C hermes-agent rev-parse --short HEAD)"
echo "    hermes-agent @ ${HERMES_SHA}"

echo "==> Building verxio-api + verxio-web"
"${COMPOSE[@]}" build --build-arg INSTALL_TURSO=1 verxio-api verxio-web

# Recreate control plane before Hermes so a Hermes BuildKit failure cannot leave
# production stuck on yesterday's api/web containers.
echo "==> Recreating control-plane services"
"${COMPOSE[@]}" up -d --force-recreate verxio-api verxio-web

echo "==> Building Hermes runtime image (${HERMES_IMAGE})"
HERMES_BEFORE="$(image_id "${HERMES_IMAGE}")"
echo "    before: ${HERMES_BEFORE}"

docker build \
  -t "${HERMES_IMAGE}" \
  --build-arg "HERMES_GIT_SHA=${HERMES_SHA}" \
  -f hermes-agent/Dockerfile \
  hermes-agent

# Keep compose's named service tag in sync for operators using compose later.
"${COMPOSE[@]}" --profile image build \
  --build-arg "HERMES_GIT_SHA=${HERMES_SHA}" \
  hermes-runtime-image

HERMES_AFTER="$(image_id "${HERMES_IMAGE}")"
echo "    after:  ${HERMES_AFTER}"
if [[ "${HERMES_AFTER}" == "(missing)" ]]; then
  echo "ERROR: ${HERMES_IMAGE} was not produced by the Hermes build."
  exit 1
fi
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' \
  | grep -E "REPOSITORY|$(printf '%s' "${HERMES_IMAGE}" | cut -d: -f1)" || true

# Confirm the baked image includes the Verxio session-token WS auth path.
if ! docker run --rm --entrypoint grep "${HERMES_IMAGE}" -q \
  "Headless control planes" /opt/hermes/hermes_cli/web_server.py; then
  echo "ERROR: ${HERMES_IMAGE} is missing Verxio session-token WS auth (Headless control planes)."
  echo "       hermes-agent checkout is too old or the image build used stale context."
  exit 1
fi
echo "    verified: session-token WS auth present in image"

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
echo "Done. Hermes image: ${HERMES_IMAGE} @ hermes-agent ${HERMES_SHA}"
echo "Open the app once so Verxio starts fresh Hermes runtimes from the new image."
echo "Quick check: curl -sS -m 5 -w ' time=%{time_total}\\n' http://127.0.0.1:8787/api/health"
