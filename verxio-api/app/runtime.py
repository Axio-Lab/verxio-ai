from __future__ import annotations

import asyncio
import json
import os
import secrets
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.models import AgentProfile, HermesRuntimeMetadata, RuntimeResult, RuntimeStatus, Workspace


DEFAULT_HERMES_BASE_URL = "http://127.0.0.1:8642"
WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_HERMES_REPO = WORKSPACE_ROOT / "hermes-agent"
VERXIO_STATE_DIR = WORKSPACE_ROOT / ".verxio"
LOCAL_RUNTIME_STATE = VERXIO_STATE_DIR / "runtime.json"
LOCAL_RUNTIME_LOG = VERXIO_STATE_DIR / "hermes-gateway.log"


@dataclass(frozen=True)
class RuntimeSettings:
    mode: str
    base_url: str
    api_key: str
    timeout_seconds: float
    hermes_repo: Path
    autostart_local: bool


def get_runtime_settings() -> RuntimeSettings:
    hermes_repo = Path(os.getenv("VERXIO_HERMES_REPO", str(DEFAULT_HERMES_REPO))).expanduser()
    return RuntimeSettings(
        mode=os.getenv("VERXIO_RUNTIME_MODE", "auto").strip().lower() or "auto",
        base_url=os.getenv("HERMES_API_BASE_URL", DEFAULT_HERMES_BASE_URL).rstrip("/"),
        api_key=os.getenv("HERMES_API_KEY", "").strip(),
        timeout_seconds=float(os.getenv("VERXIO_HERMES_TIMEOUT_SECONDS", "180")),
        hermes_repo=hermes_repo,
        autostart_local=os.getenv("VERXIO_AUTOSTART_HERMES", "true").strip().lower()
        not in {"0", "false", "no", "off"},
    )


def build_agent_instructions(workspace: Workspace, profile: AgentProfile) -> str:
    return "\n".join(
        [
            f"You are {profile.name}, {profile.role}, running inside Verxio.",
            f"Workspace: {workspace.name} ({workspace.region}).",
            "",
            "Verxio is the product skin. Hermes Agent is the runtime.",
            "",
            "Runtime expectations:",
            "- Use the model, memory, skills, tools, MCP servers, gateway connections, and cron setup configured in Hermes.",
            "- Treat `/workspace` as the runtime workspace when Hermes is containerized.",
            "- Save generated reports, dashboards, documents, and exports under `/workspace/artifacts`.",
            "- If a capability is missing, say which Hermes setting or connection appears missing.",
            "- Behave like the normal Hermes assistant, but present yourself through Verxio.",
            "- Be concise unless the user asks for depth.",
        ]
    )


def build_agent_input(profile: AgentProfile, user_input: str) -> str:
    starters = "\n".join(f"- {starter}" for starter in profile.starters)
    return (
        f"Verxio profile: {profile.name}\n"
        f"Capabilities Verxio expects from Hermes:\n"
        + "\n".join(f"- {capability}" for capability in profile.capabilities)
        + "\n\n"
        f"Suggested starters:\n{starters}\n\n"
        f"User request:\n{user_input}"
    )


class HermesRuntimeAdapter:
    def __init__(self, settings: RuntimeSettings | None = None):
        self.settings = settings or get_runtime_settings()

    async def status(self) -> RuntimeStatus:
        if self.settings.mode == "demo":
            return RuntimeStatus(
                mode="demo",
                configured=False,
                connected=False,
                base_url=self.settings.base_url,
                detail="Demo runtime is active. Set VERXIO_RUNTIME_MODE=hermes to require Hermes.",
            )

        api_key = self._effective_api_key()
        if not api_key:
            return RuntimeStatus(
                mode=self._normalized_mode(),
                configured=False,
                connected=False,
                base_url=self.settings.base_url,
                detail=(
                    "No Hermes API key is configured and no local hermes-agent clone was found. "
                    "Set HERMES_API_KEY or place the Hermes clone at ./hermes-agent."
                ),
            )

        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(
                    f"{self.settings.base_url}/health",
                    headers=self._headers(api_key),
                )
                response.raise_for_status()
            return RuntimeStatus(
                mode=self._normalized_mode(),
                configured=True,
                connected=True,
                base_url=self.settings.base_url,
                detail="Hermes API server is reachable.",
            )
        except Exception as exc:
            if self._has_local_hermes_clone():
                return RuntimeStatus(
                    mode=self._normalized_mode(),
                    configured=True,
                    connected=False,
                    base_url=self.settings.base_url,
                    detail=(
                        "Local hermes-agent clone detected. Verxio will start Hermes automatically "
                        f"on the next run. Last health check: {exc}"
                    ),
                )
            return RuntimeStatus(
                mode=self._normalized_mode(),
                configured=True,
                connected=False,
                base_url=self.settings.base_url,
                detail=f"Hermes API server is not reachable: {exc}",
            )

    async def metadata(self) -> HermesRuntimeMetadata:
        if self.settings.mode == "demo":
            return HermesRuntimeMetadata(errors=["Demo mode is enabled; Hermes metadata is unavailable."])

        api_key = self._effective_api_key()
        if not api_key:
            return HermesRuntimeMetadata(errors=["Missing Hermes API key or local Hermes clone."])

        if self.settings.autostart_local and self._has_local_hermes_clone():
            try:
                await self._ensure_local_hermes_running(api_key)
            except Exception as exc:
                return HermesRuntimeMetadata(errors=[str(exc)])

        errors: list[str] = []
        async with httpx.AsyncClient(timeout=10) as client:
            health = await self._get_json(client, "/health/detailed", api_key, errors)
            capabilities = await self._get_json(client, "/v1/capabilities", api_key, errors)
            models_payload = await self._get_json(client, "/v1/models", api_key, errors)
            jobs_payload = await self._get_json(client, "/api/jobs", api_key, errors)
            skills_payload = await self._get_json(client, "/v1/skills", api_key, errors)
            toolsets_payload = await self._get_json(client, "/v1/toolsets", api_key, errors)

        return HermesRuntimeMetadata(
            capabilities=capabilities if isinstance(capabilities, dict) else {},
            health=health if isinstance(health, dict) else {},
            models=self._coerce_list(models_payload, "data"),
            jobs=self._coerce_list(jobs_payload, "jobs"),
            skills=self._coerce_list(skills_payload, "skills"),
            toolsets=self._coerce_list(toolsets_payload, "toolsets"),
            errors=errors,
        )

    async def run_agent(self, workspace: Workspace, profile: AgentProfile, user_input: str) -> RuntimeResult:
        if self.settings.mode == "demo":
            return self._demo_result(profile, user_input)

        api_key = self._effective_api_key()
        if not api_key:
            if self.settings.mode == "hermes":
                return RuntimeResult(
                    provider="hermes",
                    status="failed",
                    output="",
                    error=(
                        "Hermes runtime is required, but Verxio could not find HERMES_API_KEY "
                        "or a local ./hermes-agent clone."
                    ),
                )
            return RuntimeResult(
                provider="hermes",
                status="failed",
                output="",
                error="Verxio could not find a local Hermes runtime for this run.",
            )

        try:
            if self.settings.autostart_local and self._has_local_hermes_clone():
                await self._ensure_local_hermes_running(api_key)
            return await self._run_via_hermes(workspace, profile, user_input, api_key)
        except Exception as exc:
            if self.settings.mode in {"hermes", "auto"}:
                return RuntimeResult(
                    provider="hermes",
                    status="failed",
                    output="",
                    error=str(exc),
                )
            result = self._demo_result(profile, user_input)
            result.output = (
                f"{result.output}\n\nRuntime note: Hermes was not reachable, so this was generated by the Verxio demo adapter."
            )
            return result

    async def submit_agent_run(self, workspace: Workspace, profile: AgentProfile, user_input: str) -> RuntimeResult:
        if self.settings.mode == "demo":
            return self._demo_result(profile, user_input)

        api_key = self._effective_api_key()
        if not api_key:
            return RuntimeResult(
                provider="hermes",
                status="failed",
                output="",
                error="Verxio could not find a local Hermes runtime for this run.",
            )

        try:
            if self.settings.autostart_local and self._has_local_hermes_clone():
                await self._ensure_local_hermes_running(api_key)
            hermes_run_id = await self._start_hermes_run(workspace, profile, user_input, api_key)
            return RuntimeResult(
                provider="hermes",
                status="running",
                output=(
                    "Hermes accepted the run. Verxio will keep checking status instead of blocking the page."
                ),
                hermes_run_id=hermes_run_id,
            )
        except Exception as exc:
            return RuntimeResult(
                provider="hermes",
                status="failed",
                output="",
                error=str(exc),
            )

    async def get_run_status(self, hermes_run_id: str) -> RuntimeResult:
        api_key = self._effective_api_key()
        if not api_key:
            return RuntimeResult(
                provider="hermes",
                status="failed",
                output="",
                hermes_run_id=hermes_run_id,
                error="Missing Hermes API key for run status lookup.",
            )

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{self.settings.base_url}/v1/runs/{hermes_run_id}",
                headers=self._headers(api_key),
            )
            response.raise_for_status()
            payload = response.json()

        status = str(payload.get("status") or "running")
        usage = self._coerce_usage(payload.get("usage"))
        if status == "completed":
            return RuntimeResult(
                provider="hermes",
                status="completed",
                output=str(payload.get("output") or ""),
                hermes_run_id=hermes_run_id,
                usage=usage,
            )
        if status == "failed":
            error = str(payload.get("error") or "Hermes run failed.")
            return RuntimeResult(
                provider="hermes",
                status="failed",
                output=error,
                hermes_run_id=hermes_run_id,
                usage=usage,
                error=error,
            )
        if status == "cancelled":
            return RuntimeResult(
                provider="hermes",
                status="cancelled",
                output="Hermes cancelled this run.",
                hermes_run_id=hermes_run_id,
                usage=usage,
            )
        if status == "waiting_for_approval":
            return RuntimeResult(
                provider="hermes",
                status="waiting_for_approval",
                output="Hermes is waiting for an approval decision.",
                hermes_run_id=hermes_run_id,
                usage=usage,
            )

        last_event = payload.get("last_event")
        suffix = f" Last event: {last_event}." if last_event else ""
        return RuntimeResult(
            provider="hermes",
            status="running" if status not in {"queued"} else "queued",
            output=f"Hermes is {status}.{suffix}",
            hermes_run_id=hermes_run_id,
            usage=usage,
        )

    async def stop_run(self, hermes_run_id: str) -> RuntimeResult:
        api_key = self._effective_api_key()
        if not api_key:
            return RuntimeResult(
                provider="hermes",
                status="failed",
                output="",
                hermes_run_id=hermes_run_id,
                error="Missing Hermes API key for stop request.",
            )

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{self.settings.base_url}/v1/runs/{hermes_run_id}/stop",
                headers=self._headers(api_key),
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    return RuntimeResult(
                        provider="hermes",
                        status="cancelled",
                        output="No active Hermes run was found to stop. It may have already finished.",
                        hermes_run_id=hermes_run_id,
                    )
                raise
        return RuntimeResult(
            provider="hermes",
            status="cancelled",
            output="Stop requested for this Hermes run.",
            hermes_run_id=hermes_run_id,
        )

    async def _run_via_hermes(
        self,
        workspace: Workspace,
        profile: AgentProfile,
        user_input: str,
        api_key: str | None = None,
    ) -> RuntimeResult:
        async with httpx.AsyncClient(timeout=self.settings.timeout_seconds) as client:
            hermes_run_id = await self._start_hermes_run(
                workspace,
                profile,
                user_input,
                api_key,
                client=client,
            )
            try:
                status_payload = await self._poll_run(client, hermes_run_id, api_key)
            except TimeoutError as exc:
                return RuntimeResult(
                    provider="hermes",
                    status="failed",
                    output=(
                        f"Hermes run {hermes_run_id} is still running after "
                        f"{self.settings.timeout_seconds:.0f}s. Verxio started the real Hermes runtime; "
                        "increase VERXIO_HERMES_TIMEOUT_SECONDS or inspect the run status."
                    ),
                    hermes_run_id=hermes_run_id,
                    error=str(exc),
                )

        status = status_payload.get("status", "failed")
        if status == "completed":
            return RuntimeResult(
                provider="hermes",
                status="completed",
                output=str(status_payload.get("output") or ""),
                hermes_run_id=hermes_run_id,
                usage=self._coerce_usage(status_payload.get("usage")),
            )
        if status == "waiting_for_approval":
            return RuntimeResult(
                provider="hermes",
                status="waiting_for_approval",
                output="Hermes is waiting for an approval decision.",
                hermes_run_id=hermes_run_id,
            )
        return RuntimeResult(
            provider="hermes",
            status="failed",
            output="",
            hermes_run_id=hermes_run_id,
            error=str(status_payload.get("error") or "Hermes run failed."),
        )

    async def _start_hermes_run(
        self,
        workspace: Workspace,
        profile: AgentProfile,
        user_input: str,
        api_key: str | None,
        client: httpx.AsyncClient | None = None,
    ) -> str:
        instructions = build_agent_instructions(workspace, profile)
        prompt = build_agent_input(profile, user_input)
        body = {
            # This is the API-server model alias. The real provider/model is chosen by Hermes config.
            "model": "hermes-agent",
            "input": prompt,
            "instructions": instructions,
            "session_id": f"verxio-{workspace.id}-{profile.id}",
        }

        async def _post(run_client: httpx.AsyncClient) -> str:
            response = await run_client.post(
                f"{self.settings.base_url}/v1/runs",
                headers={
                    **self._headers(api_key),
                    "X-Hermes-Session-Key": f"verxio:{workspace.id}:{profile.id}",
                },
                json=body,
            )
            response.raise_for_status()
            run_payload = response.json()
            hermes_run_id = run_payload.get("run_id")
            if not hermes_run_id:
                raise RuntimeError("Hermes did not return a run_id.")
            return str(hermes_run_id)

        if client is not None:
            return await _post(client)

        async with httpx.AsyncClient(timeout=20) as owned_client:
            return await _post(owned_client)

    async def _poll_run(
        self,
        client: httpx.AsyncClient,
        run_id: str,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        deadline = asyncio.get_running_loop().time() + self.settings.timeout_seconds
        while asyncio.get_running_loop().time() < deadline:
            response = await client.get(
                f"{self.settings.base_url}/v1/runs/{run_id}",
                headers=self._headers(api_key),
            )
            response.raise_for_status()
            payload = response.json()
            status = payload.get("status")
            if status in {"completed", "failed", "cancelled", "waiting_for_approval"}:
                return payload
            await asyncio.sleep(0.75)
        raise TimeoutError(f"Hermes run {run_id} did not finish within {self.settings.timeout_seconds:.0f}s.")

    def _demo_result(self, profile: AgentProfile, user_input: str) -> RuntimeResult:
        approval_hint = ""
        lowered = user_input.lower()
        if any(term in lowered for term in ["send", "broadcast", "delete", "refund", "reward", "external"]):
            approval_hint = "\n\nNote: external or destructive actions should still use Hermes approval controls."

        output = (
            f"{profile.name} is running in explicit demo mode.\n\n"
            f"Summary: {user_input.strip()}\n\n"
            "Set `VERXIO_RUNTIME_MODE=auto` or `hermes` to route this through the local Hermes Agent runtime."
            f"{approval_hint}"
        )
        return RuntimeResult(provider="demo", status="completed", output=output)

    async def _get_json(
        self,
        client: httpx.AsyncClient,
        path: str,
        api_key: str,
        errors: list[str],
    ) -> Any:
        try:
            response = await client.get(f"{self.settings.base_url}{path}", headers=self._headers(api_key))
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            errors.append(f"{path}: {exc}")
            return {}

    def _coerce_list(self, payload: Any, preferred_key: str) -> list[dict]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            value = payload.get(preferred_key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            data = payload.get("data")
            if isinstance(data, list):
                return [item for item in data if isinstance(item, dict)]
        return []

    async def _ensure_local_hermes_running(self, api_key: str) -> None:
        if await self._can_reach_hermes(api_key):
            return
        if not self._has_local_hermes_clone():
            raise RuntimeError("Local Hermes clone not found at ./hermes-agent.")
        if not self.settings.autostart_local:
            raise RuntimeError("Local Hermes autostart is disabled.")

        VERXIO_STATE_DIR.mkdir(parents=True, exist_ok=True)
        uv = shutil.which("uv")
        if uv:
            cmd = [
                uv,
                "--directory",
                str(self.settings.hermes_repo),
                "--project",
                str(self.settings.hermes_repo),
                "run",
                "--extra",
                "messaging",
                "python",
                "-m",
                "hermes_cli.main",
                "gateway",
                "run",
            ]
        else:
            cmd = [sys.executable, "-m", "hermes_cli.main", "gateway", "run"]

        env = os.environ.copy()
        env.update(
            {
                "API_SERVER_ENABLED": "true",
                "API_SERVER_KEY": api_key,
                "API_SERVER_HOST": "127.0.0.1",
                "API_SERVER_PORT": self.settings.base_url.rsplit(":", 1)[-1],
                "PYTHONUNBUFFERED": "1",
            }
        )

        log_handle = LOCAL_RUNTIME_LOG.open("a", encoding="utf-8")
        subprocess.Popen(
            cmd,
            cwd=self.settings.hermes_repo,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )

        deadline = asyncio.get_running_loop().time() + 30
        last_error = ""
        while asyncio.get_running_loop().time() < deadline:
            try:
                if await self._can_reach_hermes(api_key):
                    return
            except Exception as exc:
                last_error = str(exc)
            await asyncio.sleep(1)

        raise RuntimeError(
            "Verxio started the local Hermes gateway, but the API server did not become ready. "
            f"Check {LOCAL_RUNTIME_LOG}. {last_error}"
        )

    async def _can_reach_hermes(self, api_key: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(
                    f"{self.settings.base_url}/health",
                    headers=self._headers(api_key),
                )
                response.raise_for_status()
            return True
        except Exception:
            return False

    def _effective_api_key(self) -> str:
        if self.settings.api_key:
            return self.settings.api_key
        if self._has_local_hermes_clone():
            return self._local_dev_api_key()
        return ""

    def _has_local_hermes_clone(self) -> bool:
        return (
            self.settings.hermes_repo.exists()
            and (self.settings.hermes_repo / "hermes_cli" / "main.py").exists()
            and (self.settings.hermes_repo / "gateway" / "platforms" / "api_server.py").exists()
        )

    def _local_dev_api_key(self) -> str:
        VERXIO_STATE_DIR.mkdir(parents=True, exist_ok=True)
        try:
            payload = json.loads(LOCAL_RUNTIME_STATE.read_text(encoding="utf-8"))
            key = str(payload.get("hermes_api_key") or "").strip()
            if key:
                return key
        except (OSError, json.JSONDecodeError):
            pass

        key = secrets.token_hex(32)
        LOCAL_RUNTIME_STATE.write_text(
            json.dumps(
                {
                    "hermes_api_key": key,
                    "hermes_repo": str(self.settings.hermes_repo),
                    "base_url": self.settings.base_url,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return key

    def _headers(self, api_key: str | None = None) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        resolved_key = api_key or self.settings.api_key
        if resolved_key:
            headers["Authorization"] = f"Bearer {resolved_key}"
        return headers

    def _normalized_mode(self) -> str:
        if self.settings.mode in {"demo", "auto", "hermes"}:
            return self.settings.mode
        return "auto"

    def _coerce_usage(self, usage: Any) -> dict[str, int]:
        if not isinstance(usage, dict):
            return {}
        clean: dict[str, int] = {}
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            try:
                clean[key] = int(usage.get(key, 0) or 0)
            except (TypeError, ValueError):
                clean[key] = 0
        return clean
