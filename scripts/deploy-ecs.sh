#!/usr/bin/env bash
# Deploy Verxio on ECS: pull DEPLOY_REF (default main), rebuild services +
# Hermes runtime image, recreate control plane, and wipe per-user runtimes so
# they boot on the new image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Hermes Dockerfile uses COPY --chmod=… which requires BuildKit via buildx.
# Docker Engine 23+ falls back to the legacy builder when the buildx plugin is
# missing — DOCKER_BUILDKIT=1 alone is not enough on bare ECS hosts.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

COMPOSE=(docker compose -f docker-compose.verxio.yml)
HERMES_IMAGE="${VERXIO_HERMES_IMAGE:-verxio-hermes-runtime:local}"
# Default main. For current production branch: DEPLOY_REF=verxio/web bash scripts/deploy-ecs.sh
DEPLOY_REF="${DEPLOY_REF:-main}"
# Cold start after recreate can exceed 30s (migrations / Turso / workers).
API_HEALTH_TIMEOUT_SECONDS="${API_HEALTH_TIMEOUT_SECONDS:-120}"

image_id() {
  docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || echo "(missing)"
}

# Aliyun/Ubuntu apt often lacks docker-buildx-plugin. Download the official
# buildx binary into the Docker CLI plugins path when missing.
BUILDX_VERSION="${VERXIO_BUILDX_VERSION:-v0.23.0}"

ensure_buildx() {
  if docker buildx version >/dev/null 2>&1; then
    return 0
  fi

  local arch plugin_dir plugin url
  case "$(uname -m)" in
    x86_64 | amd64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *)
      echo "ERROR: unsupported architecture $(uname -m) for docker buildx auto-install."
      exit 1
      ;;
  esac

  if [[ "$(id -u)" -eq 0 ]]; then
    plugin_dir="/usr/local/lib/docker/cli-plugins"
  else
    plugin_dir="${HOME}/.docker/cli-plugins"
  fi
  plugin="${plugin_dir}/docker-buildx"
  url="https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${arch}"

  echo "==> Installing docker buildx ${BUILDX_VERSION} (${arch}) into ${plugin}"
  mkdir -p "${plugin_dir}"
  curl -fsSL --retry 3 -o "${plugin}.tmp" "${url}"
  chmod +x "${plugin}.tmp"
  mv "${plugin}.tmp" "${plugin}"

  if ! docker buildx version >/dev/null 2>&1; then
    echo "ERROR: docker buildx is still unavailable after installing ${plugin}."
    echo "       Hermes Dockerfile uses COPY --chmod and needs BuildKit/buildx."
    echo "       Manual install: https://docs.docker.com/go/buildx/"
    exit 1
  fi

  docker buildx version
}

build_hermes_image() {
  ensure_buildx
  docker buildx build --load \
    -t "${HERMES_IMAGE}" \
    --build-arg "HERMES_GIT_SHA=${HERMES_SHA}" \
    -f hermes-agent/Dockerfile \
    hermes-agent
}

echo "==> Pulling ${DEPLOY_REF}"
git fetch origin
git checkout "${DEPLOY_REF}"
git pull origin "${DEPLOY_REF}"
git submodule update --init --recursive

# Re-exec after pull so script updates (BuildKit/buildx, recreate order) apply
# immediately instead of continuing with the pre-pull script in memory.
if [[ "${VERXIO_DEPLOY_REEXEC:-}" != "1" ]]; then
  export VERXIO_DEPLOY_REEXEC=1
  exec bash "$ROOT/scripts/deploy-ecs.sh" "$@"
fi

if [[ -n "$(git -C hermes-agent status --porcelain 2>/dev/null || true)" ]]; then
  echo "ERROR: hermes-agent submodule has local modifications after checkout."
  echo "       Commit/push those changes (and update the parent pointer) before deploying,"
  echo "       or they will not be baked into ${HERMES_IMAGE}."
  git -C hermes-agent status --short
  exit 1
fi

HERMES_SHA="$(git -C hermes-agent rev-parse --short HEAD)"
echo "    hermes-agent @ ${HERMES_SHA}"

ensure_buildx

echo "==> Building verxio-api + verxio-web + verxio-landing"
"${COMPOSE[@]}" build --build-arg INSTALL_TURSO=1 verxio-api verxio-web verxio-landing

# Recreate control plane before Hermes so a Hermes build failure cannot leave
# production stuck on yesterday's api/web/landing containers.
echo "==> Recreating control-plane services"
"${COMPOSE[@]}" up -d --force-recreate verxio-api verxio-web verxio-landing

echo "==> Waiting for API health (timeout ${API_HEALTH_TIMEOUT_SECONDS}s)"
api_ready=0
web_ready=0
landing_ready=0
for ((elapsed = 1; elapsed <= API_HEALTH_TIMEOUT_SECONDS; elapsed++)); do
  if [[ "${api_ready}" -ne 1 ]] \
    && curl -fsS -m 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    api_ready=1
    echo "    api healthy after ${elapsed}s"
  fi
  if [[ "${web_ready}" -ne 1 ]] \
    && curl -fsS -m 2 -o /dev/null http://127.0.0.1:8080/ >/dev/null 2>&1; then
    web_ready=1
    echo "    web healthy after ${elapsed}s"
  fi
  if [[ "${landing_ready}" -ne 1 ]] \
    && curl -fsS -m 2 -o /dev/null http://127.0.0.1:8081/ >/dev/null 2>&1; then
    landing_ready=1
    echo "    landing healthy after ${elapsed}s"
  fi
  if [[ "${api_ready}" -eq 1 && "${web_ready}" -eq 1 && "${landing_ready}" -eq 1 ]]; then
    break
  fi
  if ((elapsed % 10 == 0)); then
    echo "    still waiting… ${elapsed}s (api=${api_ready} web=${web_ready} landing=${landing_ready})"
  fi
  sleep 1
done
if [[ "${api_ready}" -ne 1 ]]; then
  echo "ERROR: verxio-api did not become healthy within ${API_HEALTH_TIMEOUT_SECONDS}s."
  "${COMPOSE[@]}" logs --tail=80 verxio-api || true
  exit 1
fi
if [[ "${web_ready}" -ne 1 ]]; then
  echo "ERROR: verxio-web did not become healthy within ${API_HEALTH_TIMEOUT_SECONDS}s."
  "${COMPOSE[@]}" logs --tail=80 verxio-web || true
  exit 1
fi
if [[ "${landing_ready}" -ne 1 ]]; then
  echo "ERROR: verxio-landing did not become healthy within ${API_HEALTH_TIMEOUT_SECONDS}s."
  "${COMPOSE[@]}" logs --tail=80 verxio-landing || true
  exit 1
fi
curl -sS -m 5 -w ' time=%{time_total}\n' http://127.0.0.1:8787/api/health
curl -sS -m 5 -o /dev/null -w 'web time=%{time_total}\n' http://127.0.0.1:8080/
curl -sS -m 5 -o /dev/null -w 'landing time=%{time_total}\n' http://127.0.0.1:8081/

echo "==> Building Hermes runtime image (${HERMES_IMAGE})"
HERMES_BEFORE="$(image_id "${HERMES_IMAGE}")"
echo "    before: ${HERMES_BEFORE}"

build_hermes_image

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

if [[ "${HERMES_BEFORE}" == "${HERMES_AFTER}" && "${VERXIO_FORCE_RUNTIME_WIPE:-}" != "1" ]]; then
  echo "==> Hermes image unchanged; leaving per-user runtimes running"
else
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
