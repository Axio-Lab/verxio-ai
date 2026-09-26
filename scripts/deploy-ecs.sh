#!/usr/bin/env bash
# Deploy Verxio on ECS: pull DEPLOY_REF (default main), rebuild the control
# plane and the pool Hermes image, then roll the always-on pool services.
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
    -t verxio-hermes-base:local \
    --build-arg HERMES_INSTALL_BROWSER=0 \
    --build-arg "HERMES_GIT_SHA=${HERMES_SHA}" \
    -f hermes-agent/Dockerfile \
    hermes-agent
  docker buildx build --load \
    -t "${HERMES_IMAGE}" \
    --build-arg BASE=verxio-hermes-base:local \
    -f hermes-agent/Dockerfile.verxio-hosted \
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
"${COMPOSE[@]}" build --build-arg INSTALL_TURSO=1 --build-arg INSTALL_SCALE=1 verxio-api verxio-web verxio-landing

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

echo "==> Building pool Hermes image (${HERMES_IMAGE})"
build_hermes_image
if [[ "$(image_id "${HERMES_IMAGE}")" == "(missing)" ]]; then
  echo "ERROR: ${HERMES_IMAGE} was not produced by the Hermes build."
  exit 1
fi

echo "==> Applying migrations and rolling pool services"
docker exec -i verxio-ai-verxio-api-1 python -m app.migrate
"${COMPOSE[@]}" --profile pool up -d --force-recreate \
  verxio-scheduler verxio-hermes-worker verxio-agent-worker verxio-channel-gateway

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
  echo "==> Reloading Caddy"
  systemctl reload caddy || true
fi

echo "==> Status"
"${COMPOSE[@]}" ps
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' | grep -E 'REPOSITORY|verxio' || true

echo
echo "Done. Pool Hermes image: ${HERMES_IMAGE} @ hermes-agent ${HERMES_SHA}"
echo "Quick check: curl -sS -m 5 -w ' time=%{time_total}\\n' http://127.0.0.1:8787/api/health"
