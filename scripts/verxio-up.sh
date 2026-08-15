#!/usr/bin/env bash
# Local production-parity stack: Compose (web+api) + kind (Hermes runtimes).
# One command. Kind is required here; local-docker is the fallback, not the default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

COMPOSE=(docker compose -f docker-compose.verxio.yml -f docker-compose.kind.yml)
CLUSTER_NAME="${VERXIO_KIND_CLUSTER:-verxio}"

echo "==> Kind cluster + kubeconfig + runtime image"
bash "$ROOT/deploy/k8s/setup-kind-local.sh"

echo "==> Compose web + api on the kind network (k8s manager — stops local-docker API)"
"${COMPOSE[@]}" up -d --force-recreate --remove-orphans verxio-api verxio-web

echo "==> Removing Docker runtimes the old API may have respawned"
docker ps -aq --filter name=verxio-ws- | while read -r id; do
  docker rm -f "$id" >/dev/null
done

echo "==> Waiting for API health"
for _ in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS -m 5 http://127.0.0.1:8787/api/health
echo

echo "==> Reconciling missing runtimes, then waking the latest"
docker exec -i verxio-ai-verxio-api-1 python3 - <<'PY'
import asyncio
from app import db
from app.control_plane import runtime_from_row
from app.runtime_orch.factory import get_runtime_manager, reset_runtime_manager_for_tests
from app.runtime_orch.lifecycle import reconcile_missing_runtimes, wake_runtime

reset_runtime_manager_for_tests()
manager = get_runtime_manager()
print("manager", manager.name)
print("reconcile", asyncio.run(reconcile_missing_runtimes(wake=True, inline=True, reason="verxio-up")))
row = db.fetch_one("SELECT * FROM runtime_instances ORDER BY last_started_at DESC LIMIT 1")
if not row:
    raise SystemExit("no runtime_instances row — sign in once from the web UI, then re-run")
runtime = runtime_from_row(row)
started = asyncio.run(wake_runtime(runtime, wait_ready=False, reason="verxio-up"))
print("runtime", started.id, "status", started.status, "manager", started.manager)
print("dashboard", started.dashboard_url)
print("pod create requested (not waiting here)")
PY

POD_NAME=$(docker exec -i verxio-ai-verxio-api-1 python3 - <<'PY'
from app import db
row = db.fetch_one("SELECT container_name FROM runtime_instances ORDER BY last_started_at DESC LIMIT 1")
print((row["container_name"] if row else "").lower().replace("_", "-")[:63])
PY
)
echo "==> Waiting for pod ${POD_NAME}"
kubectl --context "kind-${CLUSTER_NAME}" -n verxio-runtimes wait --for=condition=Ready "pod/${POD_NAME}" --timeout=180s || true
kubectl --context "kind-${CLUSTER_NAME}" -n verxio-runtimes get pods -o wide

echo "==> Confirming dashboard from the API"
docker exec -i verxio-ai-verxio-api-1 python3 - <<'PY'
import asyncio
from app import db
from app.control_plane import runtime_from_row, save_runtime, now_iso
from app.runtime_orch.factory import get_runtime_manager, reset_runtime_manager_for_tests
from app.runtime_orch.states import RuntimeStatus

reset_runtime_manager_for_tests()
manager = get_runtime_manager()
row = db.fetch_one("SELECT * FROM runtime_instances ORDER BY last_started_at DESC LIMIT 1")
runtime = runtime_from_row(row)
ok, detail = asyncio.run(manager.health(runtime))
print("health", ok, detail)
if ok:
    save_runtime(runtime, status=RuntimeStatus.RUNNING, last_seen_at=now_iso(), last_error=None)
else:
    raise SystemExit(detail)
PY

echo
echo "==> Stack"
"${COMPOSE[@]}" ps
kubectl --context "kind-${CLUSTER_NAME}" -n verxio-runtimes get pods -o wide
echo
echo "Web:  http://127.0.0.1:8080"
echo "Down: bash scripts/verxio-down.sh"
