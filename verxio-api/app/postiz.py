from __future__ import annotations

import json
import logging
import os
import secrets
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

import httpx
import yaml
from fastapi import HTTPException

from app import db
from app.control_plane import now_iso
from app.models import AgentProfile, PostizToolBridgeStatus, PostizWorkspaceRecord, RuntimeInstance, Workspace, new_id
from app.pulse import decrypt_credentials, encrypt_credentials

logger = logging.getLogger(__name__)

POSTIZ_MCP_SERVER_NAME = "postiz"
POSTIZ_PROMPT_START = "<!-- VERXIO_POSTIZ_CONTEXT_START -->"
POSTIZ_PROMPT_END = "<!-- VERXIO_POSTIZ_CONTEXT_END -->"

_STATUS_ACTIVE = "active"
_STATUS_DISABLED = "disabled"
_STATUS_NEEDS_API_KEY = "needs_api_key"
_STATUS_ERROR = "error"


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _internal_url() -> str:
    return os.getenv("POSTIZ_INTERNAL_URL", "http://postiz:5000").strip().rstrip("/")


def _public_url() -> str:
    return os.getenv("POSTIZ_PUBLIC_URL", "http://127.0.0.1:4007").strip().rstrip("/")


def public_url() -> str:
    return _public_url()


def _platform_api_key() -> str:
    return os.getenv("POSTIZ_PLATFORM_API_KEY", "").strip()


def _bootstrap_api_key() -> str:
    return os.getenv("POSTIZ_BOOTSTRAP_API_KEY", "").strip()


def is_postiz_configured() -> bool:
    """Return True when the platform operator has wired a Postiz backend."""

    if os.getenv("POSTIZ_DISABLED", "").strip().lower() in {"1", "true", "yes", "on"}:
        return False

    return bool(
        _internal_url()
        or _platform_api_key()
        or _bootstrap_api_key()
        or os.getenv("POSTIZ_INTERNAL_URL", "").strip()
        or os.getenv("POSTIZ_PUBLIC_URL", "").strip()
    )


def get_binding(workspace_id: str) -> PostizWorkspaceRecord | None:
    row = db.fetch_one(
        """
        SELECT * FROM postiz_workspaces
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (workspace_id,),
    )
    if not row:
        return None
    return _row_to_record(row)


def _row_to_record(row: dict[str, Any]) -> PostizWorkspaceRecord:
    metadata = _json_loads(row.get("metadata_json"), {})
    message = str(metadata.get("message") or "") if isinstance(metadata, dict) else ""
    return PostizWorkspaceRecord(
        id=str(row["id"]),
        workspaceId=str(row["workspace_id"]),
        agentId=str(row["agent_id"]),
        postizOrgId=str(row.get("postiz_org_id") or ""),
        postizUserId=str(row.get("postiz_user_id") or ""),
        status=str(row.get("status") or _STATUS_DISABLED),
        message=message,
        createdAt=str(row["created_at"]),
        updatedAt=str(row["updated_at"]),
    )


def _binding_credentials(row: dict[str, Any]) -> dict[str, str]:
    return decrypt_credentials(str(row.get("credentials_encrypted") or ""))


def _workspace_email(workspace_id: str) -> str:
    safe = workspace_id.replace("@", "_").replace(" ", "_")
    return f"ws_{safe}@verxio.local"


def _upsert_binding(
    *,
    workspace: Workspace,
    agent: AgentProfile,
    status: str,
    credentials: dict[str, str],
    postiz_org_id: str = "",
    postiz_user_id: str = "",
    message: str = "",
) -> PostizWorkspaceRecord:
    existing = db.fetch_one(
        "SELECT id FROM postiz_workspaces WHERE workspace_id = ?",
        (workspace.id,),
    )
    timestamp = now_iso()
    encrypted = encrypt_credentials(credentials)
    metadata = _json_dumps({"message": message})

    if existing:
        db.execute(
            """
            UPDATE postiz_workspaces
            SET agent_id = ?,
                postiz_org_id = ?,
                postiz_user_id = ?,
                status = ?,
                credentials_encrypted = ?,
                metadata_json = ?,
                updated_at = ?
            WHERE workspace_id = ?
            """,
            (
                agent.id,
                postiz_org_id,
                postiz_user_id,
                status,
                encrypted,
                metadata,
                timestamp,
                workspace.id,
            ),
        )
        binding_id = str(existing["id"])
    else:
        binding_id = new_id("postiz")
        db.execute(
            """
            INSERT INTO postiz_workspaces (
                id, tenant_id, workspace_id, agent_id,
                postiz_org_id, postiz_user_id, status,
                credentials_encrypted, metadata_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                binding_id,
                workspace.tenant_id,
                workspace.id,
                agent.id,
                postiz_org_id,
                postiz_user_id,
                status,
                encrypted,
                metadata,
                timestamp,
                timestamp,
            ),
        )

    row = db.fetch_one("SELECT * FROM postiz_workspaces WHERE id = ?", (binding_id,))
    if not row:
        raise HTTPException(status_code=500, detail="Postiz workspace binding could not be saved.")
    return _row_to_record(row)


def disable_for_workspace(workspace_id: str, runtime: RuntimeInstance | None = None) -> PostizWorkspaceRecord | None:
    row = db.fetch_one("SELECT * FROM postiz_workspaces WHERE workspace_id = ?", (workspace_id,))
    if not row:
        return None

    timestamp = now_iso()
    metadata = _json_loads(row.get("metadata_json"), {})
    if not isinstance(metadata, dict):
        metadata = {}
    metadata["message"] = "Postiz disabled for this workspace."

    db.execute(
        """
        UPDATE postiz_workspaces
        SET status = ?, credentials_encrypted = '', metadata_json = ?, updated_at = ?
        WHERE workspace_id = ?
        """,
        (_STATUS_DISABLED, _json_dumps(metadata), timestamp, workspace_id),
    )

    if runtime is not None:
        sync_postiz_runtime_bridge(runtime)

    updated = db.fetch_one("SELECT * FROM postiz_workspaces WHERE workspace_id = ?", (workspace_id,))
    return _row_to_record(updated) if updated else None


def enable_for_workspace(
    workspace: Workspace,
    agent: AgentProfile,
    runtime: RuntimeInstance,
) -> PostizWorkspaceRecord:
    if not is_postiz_configured():
        raise HTTPException(status_code=503, detail="Postiz is not configured on this platform.")

    platform_key = _platform_api_key()
    if platform_key:
        record = _upsert_binding(
            workspace=workspace,
            agent=agent,
            status=_STATUS_ACTIVE,
            credentials={"api_key": platform_key, "source": "platform"},
            message="Using shared POSTIZ_PLATFORM_API_KEY.",
        )
        sync_postiz_runtime_bridge(runtime)
        return record

    email = _workspace_email(workspace.id)
    password = secrets.token_urlsafe(32)

    try:
        session = _register_or_login(email, password, workspace.name)
        profile = _fetch_user_self(session)
        postiz_user_id = str(profile.get("id") or "")
        postiz_org_id = str(profile.get("orgId") or "")
        api_key = _ensure_api_key(session, profile)
        credentials = {
            "api_key": api_key,
            "email": email,
            "password": password,
            "postiz_user_id": postiz_user_id,
            "postiz_org_id": postiz_org_id,
        }
        status = _STATUS_ACTIVE if api_key else _STATUS_NEEDS_API_KEY
        message = "Postiz workspace provisioned."
        if not api_key:
            message = (
                "Postiz account created but no API key was discovered. "
                "Set POSTIZ_BOOTSTRAP_API_KEY for the first workspace or add a key in Postiz settings."
            )
        record = _upsert_binding(
            workspace=workspace,
            agent=agent,
            status=status,
            credentials=credentials,
            postiz_org_id=postiz_org_id,
            postiz_user_id=postiz_user_id,
            message=message,
        )
        sync_postiz_runtime_bridge(runtime)
        return record
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Postiz provisioning failed for workspace %s", workspace.id)
        record = _upsert_binding(
            workspace=workspace,
            agent=agent,
            status=_STATUS_ERROR,
            credentials={"email": email, "password": password},
            message=str(exc),
        )
        raise HTTPException(status_code=502, detail=f"Postiz provisioning failed: {exc}") from exc


def runtime_env_for_workspace(workspace_id: str) -> dict[str, str]:
    row = db.fetch_one(
        """
        SELECT credentials_encrypted, status FROM postiz_workspaces
        WHERE workspace_id = ? AND status = ?
        """,
        (workspace_id, _STATUS_ACTIVE),
    )
    if not row:
        return {}

    credentials = _binding_credentials(row)
    api_key = str(credentials.get("api_key") or "").strip()
    if not api_key:
        return {}

    return {
        "POSTIZ_API_URL": _internal_url(),
        "POSTIZ_API_KEY": api_key,
    }


def browser_session_for_workspace(workspace_id: str) -> dict[str, str]:
    row = db.fetch_one(
        """
        SELECT credentials_encrypted, status FROM postiz_workspaces
        WHERE workspace_id = ?
        """,
        (workspace_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Postiz is not enabled for this workspace.")

    status = str(row.get("status") or "")
    if status not in {_STATUS_ACTIVE, _STATUS_NEEDS_API_KEY}:
        raise HTTPException(status_code=409, detail=f"Postiz workspace status is '{status}'.")

    credentials = _binding_credentials(row)
    email = str(credentials.get("email") or "").strip()
    password = str(credentials.get("password") or "").strip()
    if not email or not password:
        raise HTTPException(
            status_code=409,
            detail="This workspace uses a shared Postiz API key and cannot open an automatic Postiz browser session.",
        )

    try:
        return _login(email, password)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Postiz browser session failed: {exc}") from exc


def public_v1_request(
    workspace_id: str,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: Any | None = None,
    content: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> httpx.Response:
    row = db.fetch_one(
        """
        SELECT credentials_encrypted, status FROM postiz_workspaces
        WHERE workspace_id = ?
        """,
        (workspace_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Postiz is not enabled for this workspace.")

    status = str(row.get("status") or "")
    if status != _STATUS_ACTIVE:
        raise HTTPException(status_code=409, detail=f"Postiz workspace status is '{status}'.")

    credentials = _binding_credentials(row)
    api_key = str(credentials.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=409, detail="Postiz API key is not available for this workspace.")

    normalized_path = path.lstrip("/")
    url = f"{_internal_url()}/public/v1/{normalized_path}"
    request_headers = {
        "Authorization": api_key,
        "Accept": "application/json",
    }
    if headers:
        request_headers.update(headers)

    try:
        response = httpx.request(
            method.upper(),
            url,
            params=params or {},
            json=json_body,
            content=content,
            headers=request_headers,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Postiz request failed: {exc}") from exc

    return response


def postiz_health(timeout: int = 5) -> dict[str, Any]:
    """Best-effort health snapshot for Settings; never exposes credentials."""

    try:
        response = httpx.get(f"{_internal_url()}/", timeout=timeout)
    except httpx.HTTPError as exc:
        return {"ok": False, "status": "unreachable", "message": str(exc)}

    return {
        "ok": response.status_code < 500,
        "status": response.status_code,
    }


def public_v1_json(workspace_id: str, method: str, path: str, **kwargs: Any) -> Any:
    response = public_v1_request(workspace_id, method, path, **kwargs)
    if response.status_code >= 400:
        detail = response.text.strip() or f"Postiz request failed ({response.status_code})."
        raise HTTPException(status_code=response.status_code, detail=detail)
    try:
        return response.json()
    except ValueError:
        return {}


def extract_integrations(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("integrations", "data", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def extract_posts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("posts", "data", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def sync_postiz_runtime_bridge(runtime: RuntimeInstance) -> PostizToolBridgeStatus:
    """Expose Postiz MCP tools to Hermes when the workspace has an active binding."""

    if not is_postiz_configured():
        changed = _remove_runtime_postiz_bridge(runtime)
        return PostizToolBridgeStatus(
            changed=changed,
            configured=False,
            enabled=False,
            message="Postiz is not configured.",
            serverName=POSTIZ_MCP_SERVER_NAME,
        )

    env = runtime_env_for_workspace(runtime.workspace_id)
    api_key = env.get("POSTIZ_API_KEY", "").strip()
    if not api_key:
        mcp_changed = _remove_runtime_mcp_server(runtime)
        prompt_changed = _remove_runtime_postiz_prompt(runtime)
        changed = mcp_changed or prompt_changed
        return PostizToolBridgeStatus(
            changed=changed,
            configured=True,
            enabled=False,
            message="Postiz is not enabled for this workspace.",
            serverName=POSTIZ_MCP_SERVER_NAME,
        )

    mcp_url = f"{_internal_url()}/mcp"
    config = _read_runtime_config(runtime)
    mcp_changed = _upsert_runtime_mcp_server(config, mcp_url)
    prompt_changed = _upsert_runtime_postiz_prompt(config)
    if mcp_changed or prompt_changed:
        _write_runtime_config(runtime, config)

    return PostizToolBridgeStatus(
        changed=mcp_changed or prompt_changed,
        configured=True,
        enabled=True,
        message="Postiz MCP tools are available to Verxio.",
        serverName=POSTIZ_MCP_SERVER_NAME,
    )


def _register_or_login(email: str, password: str, company: str) -> dict[str, str]:
    register_payload = {
        "email": email,
        "password": password,
        "provider": "LOCAL",
        "company": company,
    }
    with httpx.Client(base_url=_internal_url(), timeout=30, follow_redirects=True) as client:
        register = _post_first_available(client, ["/api/auth/register", "/auth/register"], register_payload)
        if register.status_code >= 400 and register.status_code not in {400, 409}:
            register.raise_for_status()

    return _login(email, password)


def _login(email: str, password: str) -> dict[str, str]:
    login_payload = {
        "email": email,
        "password": password,
        "provider": "LOCAL",
    }
    with httpx.Client(base_url=_internal_url(), timeout=30, follow_redirects=True) as client:
        login = _post_first_available(client, ["/api/auth/login", "/auth/login"], login_payload)
        if login.status_code >= 400:
            detail = login.text.strip() or f"Postiz login failed ({login.status_code})."
            raise HTTPException(status_code=502, detail=detail)

        session = _session_from_response(login)
        if not session:
            raise HTTPException(status_code=502, detail="Postiz login did not return an auth session.")
        return session


def _post_first_available(client: httpx.Client, paths: list[str], payload: dict[str, Any]) -> httpx.Response:
    last_response: httpx.Response | None = None
    for path in paths:
        response = client.post(path, json=payload)
        if response.status_code != 404:
            return response
        last_response = response
    return last_response or client.post(paths[-1], json=payload)


def _session_from_response(response: httpx.Response) -> dict[str, str]:
    auth = response.cookies.get("auth") or response.headers.get("auth")
    parsed_cookies = _cookies_from_set_cookie(response.headers.get("set-cookie", ""))
    if not auth:
        auth = parsed_cookies.get("auth", "")
    if not auth:
        return {}

    cookies = {"auth": auth}
    showorg = response.cookies.get("showorg") or response.headers.get("showorg")
    if not showorg:
        showorg = parsed_cookies.get("showorg", "")
    if showorg:
        cookies["showorg"] = showorg
    return cookies


def _cookies_from_set_cookie(value: str) -> dict[str, str]:
    if not value:
        return {}
    parsed = SimpleCookie()
    try:
        parsed.load(value)
    except Exception:
        return {}
    return {key: morsel.value for key, morsel in parsed.items()}


def _authed_client(session: dict[str, str]) -> httpx.Client:
    return httpx.Client(
        base_url=_internal_url(),
        timeout=30,
        follow_redirects=True,
        cookies=session,
        headers={"Accept": "application/json"},
    )


def _fetch_user_self(session: dict[str, str]) -> dict[str, Any]:
    with _authed_client(session) as client:
        response = _get_first_available(client, ["/api/user/self", "/user/self"])
        if response.status_code >= 400:
            detail = response.text.strip() or f"Postiz /user/self failed ({response.status_code})."
            raise HTTPException(status_code=502, detail=detail)
        payload = response.json()
        return payload if isinstance(payload, dict) else {}


def _ensure_api_key(session: dict[str, str], profile: dict[str, Any]) -> str:
    existing = str(profile.get("publicApi") or profile.get("apiKey") or "").strip()
    if existing:
        return existing

    bootstrap = _bootstrap_api_key() or _platform_api_key()
    if bootstrap:
        return bootstrap

    candidate_paths = [
        ("GET", "/api/user/self", None),
        ("GET", "/user/self", None),
        ("POST", "/api/user/api-key/rotate", None),
        ("POST", "/user/api-key/rotate", None),
        ("GET", "/api/settings/public-api", None),
        ("GET", "/settings/public-api", None),
        ("GET", "/api/settings/api-key", None),
        ("GET", "/settings/api-key", None),
    ]

    with _authed_client(session) as client:
        for method, path, body in candidate_paths:
            try:
                if method == "GET":
                    response = client.get(path)
                else:
                    response = client.post(path, json=body or {})
            except httpx.HTTPError:
                continue

            if response.status_code >= 400:
                continue

            key = _extract_api_key(response)
            if key:
                return key

        refreshed = _get_first_available(client, ["/api/user/self", "/user/self"])
        if refreshed.status_code < 400:
            payload = refreshed.json()
            if isinstance(payload, dict):
                key = str(payload.get("publicApi") or payload.get("apiKey") or "").strip()
                if key:
                    return key

    return ""


def _get_first_available(client: httpx.Client, paths: list[str]) -> httpx.Response:
    last_response: httpx.Response | None = None
    for path in paths:
        response = client.get(path)
        if response.status_code != 404:
            return response
        last_response = response
    return last_response or client.get(paths[-1])


def _extract_api_key(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        for key in ("publicApi", "apiKey", "api_key", "key"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        for nested_key in ("organization", "org", "data"):
            nested = payload.get(nested_key)
            if isinstance(nested, dict):
                for key in ("publicApi", "apiKey", "api_key", "key"):
                    value = nested.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()

    text = response.text.strip()
    if text and len(text) <= 128 and "\n" not in text:
        return text
    return ""


def _runtime_config_path(runtime: RuntimeInstance) -> Path:
    path = Path(runtime.hermes_home_path)
    path.mkdir(parents=True, exist_ok=True)
    return path / "config.yaml"


def _read_runtime_config(runtime: RuntimeInstance) -> dict[str, Any]:
    config_path = _runtime_config_path(runtime)
    if not config_path.exists():
        return {}

    try:
        payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise RuntimeError(f"Hermes config is not valid YAML: {exc}") from exc

    return payload if isinstance(payload, dict) else {}


def _write_runtime_config(runtime: RuntimeInstance, config: dict[str, Any]) -> None:
    config_path = _runtime_config_path(runtime)
    rendered = yaml.safe_dump(config, allow_unicode=False, sort_keys=False)
    config_path.write_text(rendered, encoding="utf-8")


def _upsert_runtime_mcp_server(config: dict[str, Any], mcp_url: str) -> bool:
    servers = config.get("mcp_servers")
    if not isinstance(servers, dict):
        servers = {}

    desired = {
        "connect_timeout": 30,
        "enabled": True,
        "headers": {"Authorization": "Bearer ${POSTIZ_API_KEY}"},
        "supports_parallel_tool_calls": False,
        "timeout": 120,
        "url": mcp_url,
    }

    if servers.get(POSTIZ_MCP_SERVER_NAME) == desired:
        return False

    servers[POSTIZ_MCP_SERVER_NAME] = desired
    config["mcp_servers"] = servers

    if "terminal" not in config:
        config["terminal"] = {"backend": "local", "cwd": "/workspace"}

    return True


def _remove_runtime_mcp_server(runtime: RuntimeInstance) -> bool:
    config_path = _runtime_config_path(runtime)
    if not config_path.exists():
        return False

    try:
        config = _read_runtime_config(runtime)
    except RuntimeError:
        return False

    servers = config.get("mcp_servers")
    if not isinstance(servers, dict) or POSTIZ_MCP_SERVER_NAME not in servers:
        return False

    servers.pop(POSTIZ_MCP_SERVER_NAME, None)
    if servers:
        config["mcp_servers"] = servers
    else:
        config.pop("mcp_servers", None)

    _write_runtime_config(runtime, config)
    return True


def _upsert_runtime_postiz_prompt(config: dict[str, Any]) -> bool:
    agent = config.get("agent")
    if not isinstance(agent, dict):
        agent = {}

    current_prompt = agent.get("system_prompt")
    base_prompt = _strip_managed_postiz_prompt(str(current_prompt or ""))
    desired_prompt = _join_prompt_parts(base_prompt, _build_postiz_context_prompt())

    if current_prompt == desired_prompt:
        return False

    agent["system_prompt"] = desired_prompt
    config["agent"] = agent
    return True


def _remove_runtime_postiz_prompt(runtime: RuntimeInstance) -> bool:
    config_path = _runtime_config_path(runtime)
    if not config_path.exists():
        return False

    try:
        config = _read_runtime_config(runtime)
    except RuntimeError:
        return False

    agent = config.get("agent")
    if not isinstance(agent, dict):
        return False

    current_prompt = agent.get("system_prompt")
    if not isinstance(current_prompt, str) or POSTIZ_PROMPT_START not in current_prompt:
        return False

    next_prompt = _strip_managed_postiz_prompt(current_prompt)
    if next_prompt:
        agent["system_prompt"] = next_prompt
    else:
        agent.pop("system_prompt", None)
    config["agent"] = agent
    _write_runtime_config(runtime, config)
    return True


def _remove_runtime_postiz_bridge(runtime: RuntimeInstance) -> bool:
    mcp_changed = _remove_runtime_mcp_server(runtime)
    prompt_changed = _remove_runtime_postiz_prompt(runtime)
    return mcp_changed or prompt_changed


def _strip_managed_postiz_prompt(prompt: str) -> str:
    start = prompt.find(POSTIZ_PROMPT_START)
    end = prompt.find(POSTIZ_PROMPT_END)
    if start == -1 or end == -1 or end < start:
        return prompt.strip()

    end += len(POSTIZ_PROMPT_END)
    return (prompt[:start] + prompt[end:]).strip()


def _join_prompt_parts(*parts: str) -> str:
    return "\n\n".join(part.strip() for part in parts if part and part.strip())


def _build_postiz_context_prompt() -> str:
    return "\n".join(
        [
            POSTIZ_PROMPT_START,
            "## Verxio Postiz",
            "",
            "This workspace can schedule and publish social content through Postiz.",
            "",
            "When the user asks to post, schedule, or manage social channels:",
            "1. Prefer Postiz MCP tools (`mcp_postiz_*`) for integrations, uploads, and scheduled posts.",
            "2. Use `POSTIZ_API_URL` / `POSTIZ_API_KEY` only when MCP tools are unavailable.",
            "3. Confirm connected integrations in Postiz before claiming a channel is unavailable.",
            "",
            "Do not scrape social sites when Postiz can publish directly.",
            POSTIZ_PROMPT_END,
        ]
    )
