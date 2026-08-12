"""Fly.io Machines RuntimeManager (Phase 4).

Uses Fly Machines API when VERXIO_FLY_API_TOKEN is set. Without credentials,
methods raise RuntimeManagerError — CI can skip live Fly tests.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.control_plane import now_iso, save_runtime
from app.models import RuntimeInstance
from app.runtime_orch.manager import RuntimeManagerError
from app.runtime_orch.states import RuntimeStatus, assert_transition


class FlyRuntimeManager:
    name = "fly"

    def __init__(
        self,
        *,
        api_token: str | None = None,
        app_name: str | None = None,
        api_base: str | None = None,
        image: str | None = None,
        region: str | None = None,
    ) -> None:
        self.api_token = (api_token or os.getenv("VERXIO_FLY_API_TOKEN", "")).strip()
        self.app_name = (app_name or os.getenv("VERXIO_FLY_APP", "verxio-runtimes")).strip()
        self.api_base = (api_base or os.getenv("VERXIO_FLY_API_BASE", "https://api.machines.dev/v1")).rstrip("/")
        self.image = (
            image
            or os.getenv("VERXIO_HERMES_IMAGE")
            or os.getenv("VERXIO_FLY_HERMES_IMAGE")
            or "nousresearch/hermes-agent:latest"
        )
        self.region = (region or os.getenv("VERXIO_FLY_REGION", "iad")).strip()

    def _headers(self) -> dict[str, str]:
        if not self.api_token:
            raise RuntimeManagerError("VERXIO_FLY_API_TOKEN is not configured")
        return {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

    def _machine_name(self, runtime: RuntimeInstance) -> str:
        # Fly machine names: lowercase alphanumeric and dashes.
        raw = runtime.container_name or f"verxio-{runtime.workspace_id}-{runtime.agent_id}"
        return raw.lower().replace("_", "-")[:63]

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.request(
                method,
                f"{self.api_base}{path}",
                headers=self._headers(),
                **kwargs,
            )
        return response

    async def start(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
        wait_ready: bool = True,
    ) -> RuntimeInstance:
        assert_transition(runtime.status, RuntimeStatus.STARTING)
        save_runtime(runtime, status=RuntimeStatus.STARTING, last_error=None)

        name = self._machine_name(runtime)
        env = {
            "HERMES_DASHBOARD": "1",
            "HERMES_DASHBOARD_HOST": "0.0.0.0",
            "HERMES_DASHBOARD_PORT": "9119",
            "HERMES_DASHBOARD_INSECURE": "1",
            "TERMINAL_CWD": "/workspace",
            **(extra_env or {}),
        }
        payload = {
            "name": name,
            "region": self.region,
            "config": {
                "image": self.image,
                "env": env,
                "guest": {
                    "cpu_kind": os.getenv("VERXIO_FLY_CPU_KIND", "shared"),
                    "cpus": int(os.getenv("VERXIO_FLY_CPUS", "1") or "1"),
                    "memory_mb": int(os.getenv("VERXIO_FLY_MEMORY_MB", "1024") or "1024"),
                },
                "services": [
                    {
                        "protocol": "tcp",
                        "internal_port": 9119,
                        "ports": [],
                        "autostart": True,
                        "autostop": True,
                    }
                ],
                "restart": {"policy": "no"},
            },
        }

        # Create or reuse machine.
        list_resp = await self._request("GET", f"/apps/{self.app_name}/machines")
        if list_resp.status_code >= 400:
            raise RuntimeManagerError(
                f"Fly list machines failed: {list_resp.status_code}",
                detail={"body": list_resp.text[:500]},
            )
        machines = list_resp.json()
        machine = next((m for m in machines if m.get("name") == name), None)
        if machine is None:
            create_resp = await self._request("POST", f"/apps/{self.app_name}/machines", json=payload)
            if create_resp.status_code >= 400:
                err = save_runtime(
                    runtime,
                    status=RuntimeStatus.ERROR,
                    last_error=f"Fly create failed: {create_resp.status_code} {create_resp.text[:300]}",
                )
                raise RuntimeManagerError(err.last_error or "Fly create failed", detail={"body": create_resp.text[:500]})
            machine = create_resp.json()
        else:
            start_resp = await self._request("POST", f"/apps/{self.app_name}/machines/{machine['id']}/start")
            if start_resp.status_code >= 400:
                err = save_runtime(
                    runtime,
                    status=RuntimeStatus.ERROR,
                    last_error=f"Fly start failed: {start_resp.status_code}",
                )
                raise RuntimeManagerError(err.last_error or "Fly start failed")

        machine_id = str(machine.get("id") or "")
        # Private DNS form used inside Fly 6PN.
        dashboard_url = f"http://{name}.vm.{self.app_name}.internal:9119"
        started = save_runtime(
            runtime,
            status=RuntimeStatus.STARTING if wait_ready else RuntimeStatus.RUNNING,
            container_id=machine_id,
            container_name=name,
            image=self.image,
            dashboard_url=dashboard_url,
            last_started_at=now_iso(),
            last_error=None,
            manager=self.name,
            external_ref=machine_id,
        )
        if not wait_ready:
            return started
        # Health wait — reuse HTTP probe against private URL when reachable.
        ok, detail = await self.health(started)
        if ok:
            return save_runtime(started, status=RuntimeStatus.RUNNING, last_error=None)
        return save_runtime(started, status=RuntimeStatus.STARTING, last_error=detail)

    async def stop(self, runtime: RuntimeInstance) -> RuntimeInstance:
        machine_id = runtime.container_id
        if not machine_id:
            return save_runtime(runtime, status=RuntimeStatus.STOPPED, last_error=None)
        resp = await self._request("POST", f"/apps/{self.app_name}/machines/{machine_id}/stop")
        if resp.status_code >= 400 and resp.status_code != 404:
            return save_runtime(runtime, status=RuntimeStatus.ERROR, last_error=f"Fly stop failed: {resp.status_code}")
        return save_runtime(runtime, status=RuntimeStatus.STOPPED, last_error=None)

    async def restart(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> RuntimeInstance:
        await self.stop(runtime)
        return await self.start(runtime, extra_env=extra_env, wait_ready=True)

    async def drain(self, runtime: RuntimeInstance) -> RuntimeInstance:
        draining = save_runtime(runtime, status=RuntimeStatus.DRAINING)
        try:
            from pathlib import Path

            from app.runtime_orch.artifacts_store import get_artifact_store

            store = get_artifact_store()
            key = f"runtimes/{draining.workspace_id}/{draining.agent_id}/hermes-home"
            home = Path(draining.hermes_home_path)
            if home.exists():
                store.put_directory(key, home)
        except Exception:
            pass
        return await self.stop(draining)

    async def address(self, runtime: RuntimeInstance) -> str | None:
        return runtime.dashboard_url

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        base = runtime.dashboard_url
        if not base:
            return False, "No dashboard URL"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{base.rstrip('/')}/api/health")
            if resp.status_code < 400:
                return True, "ok"
            return False, f"health {resp.status_code}"
        except Exception as exc:
            return False, str(exc)

    def supports_publish_ports(self) -> bool:
        return False
