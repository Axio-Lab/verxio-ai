from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import mimetypes
import os
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse

import httpx
import websockets
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect

from app import db
from app.auth import (
    get_current_user,
    login,
    logout,
    me,
    request_login_code,
    request_password_reset,
    require_user,
    resend_verification,
    reset_password,
    signup,
    verify_email,
    verify_login_code,
)
from app.composio_catalog import (
    complete_composio_connection,
    delete_composio_account,
    get_composio_catalog_error,
    get_composio_connection_setup,
    initiate_composio_connection,
    is_composio_catalog_ready,
    is_composio_configured,
    list_composio_app_tools,
    list_composio_accounts,
    list_composio_apps,
    sync_composio_runtime_bridge,
)
from app.postiz import (
    browser_session_for_workspace as postiz_browser_session_for_workspace,
    disable_for_workspace as disable_postiz_for_workspace,
    enable_for_workspace as enable_postiz_for_workspace,
    extract_integrations as extract_postiz_integrations,
    extract_posts as extract_postiz_posts,
    get_binding as get_postiz_binding,
    is_postiz_configured,
    postiz_health,
    public_v1_json as postiz_public_v1_json,
    public_v1_request as postiz_public_v1_request,
    runtime_env_for_workspace,
    sync_postiz_runtime_bridge,
)
from app.control_plane import ensure_runtime_directories, get_context_for_user, get_runtime_for_user
from app.inference import (
    inference_usage,
    list_inference_catalog,
    runtime_env_for_user,
    sync_inference_runtime_bridge,
    update_inference_settings,
    ensure_inference_settings,
)
from app.leash_agent import clear_leash_agent, read_leash_agent, write_leash_agent
from app.knowledge_bases import (
    create_document as create_knowledge_document,
    create_knowledge_base,
    delete_knowledge_base,
    list_documents as list_knowledge_documents,
    list_knowledge_bases,
)
from app.slack_manifest import build_slack_manifest
from app.models import (
    ArtifactListResponse,
    AuthCodeChallengeResponse,
    AuthCodeVerifyRequest,
    AuthResponse,
    AuditEvent,
    BootstrapResponse,
    ComposioAppsResponse,
    ComposioAppToolsResponse,
    ComposioCompleteConnectionRequest,
    ComposioCompleteConnectionResponse,
    ComposioConnectionSetupResponse,
    ComposioConnectionsResponse,
    ComposioInitiateRequest,
    ComposioInitiateResponse,
    EmailRequest,
    HermesRuntimeMetadata,
    InferenceCatalogResponse,
    InferenceSettings,
    InferenceSettingsUpdate,
    InferenceUsageResponse,
    KnowledgeBaseCreateRequest,
    KnowledgeBaseRecord,
    KnowledgeBasesResponse,
    KnowledgeDocumentCreateRequest,
    KnowledgeDocumentRecord,
    KnowledgeDocumentsResponse,
    LoginRequest,
    NotepadFolderCreateRequest,
    NotepadFolderRecord,
    NotepadFolderUpdateRequest,
    NotepadListResponse,
    NotepadNoteCreateRequest,
    NotepadNoteRecord,
    NotepadNoteUpdateRequest,
    NotepadRecordingUploadRequest,
    NotepadRecordingUploadResponse,
    NotepadShareResponse,
    PasswordResetRequest,
    PostizStatusResponse,
    PostizWorkspaceRecord,
    PulseAnalyticsResponse,
    PulseAutomationCreateRequest,
    PulseAutomationGenerateRequest,
    PulseAutomationListResponse,
    PulseAutomationRecord,
    PulseAutomationSimulateRequest,
    PulseAutomationSimulateResponse,
    PulseAutomationToggleRequest,
    PulseAutomationUpdateRequest,
    PulseChannelConnectRequest,
    PulseChannelConnectResponse,
    PulseChannelCreateRequest,
    PulseChannelRecord,
    PulseChannelsResponse,
    PulseConversationDetailResponse,
    PulseConversationRecord,
    PulseConversationStateRequest,
    PulseConversationsResponse,
    PulseMetaOAuthCompleteRequest,
    PulseMetaOAuthCompleteResponse,
    RuntimeInstance,
    PulseMessageRecord,
    PulseSendMessageRequest,
    PulseTagsResponse,
    PulseWebhookIngestResponse,
    PublicNotepadShareResponse,
    RunRecord,
    RunRequest,
    RuntimeControlResponse,
    RuntimeWorkspaceSyncRequest,
    SignupRequest,
    TranscriptionCatalogResponse,
    WorkflowAgentCreateRequest,
    WorkflowAgentRecord,
    WorkflowAgentsResponse,
    WorkflowAgentUpdateRequest,
    WorkflowIntegrationCapabilitiesResponse,
    WorkflowRunCreateRequest,
    WorkflowRunEventsResponse,
    WorkflowRunRecord,
    WorkflowRunsResponse,
    WorkflowSkillCapabilitiesResponse,
    WorkflowToolCapabilitiesResponse,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerRecord,
    WorkflowTriggerRunRequest,
    WorkflowTriggerRunsResponse,
    WorkflowTriggersResponse,
    WorkflowTriggerUpdateRequest,
    WorkflowWebhookIngestResponse,
)
from app.notepad import (
    create_folder,
    create_note,
    create_share,
    delete_folder,
    delete_note,
    list_notepad,
    public_share,
    revoke_share,
    summarize_note,
    update_folder,
    update_note,
)
from app.pulse import (
    analytics as pulse_analytics,
    channel_capability_matrix,
    complete_meta_oauth,
    connect_channel,
    create_automation as create_pulse_automation,
    create_channel as create_pulse_channel,
    delete_automation as delete_pulse_automation,
    delete_channel as delete_pulse_channel,
    generated_flow_from_prompt,
    get_conversation_detail as get_pulse_conversation_detail,
    list_automations as list_pulse_automations,
    list_channels as list_pulse_channels,
    list_conversations as list_pulse_conversations,
    list_tags as list_pulse_tags,
    send_human_message as send_pulse_human_message,
    simulate_automation as simulate_pulse_automation,
    toggle_automation as toggle_pulse_automation,
    update_automation as update_pulse_automation,
    update_conversation_state as update_pulse_conversation_state,
)
from app.pulse_engine import tick_due_runs as tick_pulse_due_runs
from app.pulse_webhooks import ingest_meta_webhook, ingest_whatsapp_webhook, verify_challenge
from app.runtime import HermesRuntimeAdapter, hosted_runtime_status, is_hosted_control_plane
from app.runtime_dashboard import soft_reload_runtime_mcp
from app.runtime_manager import (
    artifact_file,
    index_artifacts,
    mark_runtime_healthy,
    normalize_gateway_status_content,
    restart_runtime,
    runtime_container_env_matches,
    runtime_dashboard_base_url,
    runtime_dashboard_ws_candidates,
    runtime_health,
    runtime_live_dashboard_token,
    runtime_live_dashboard_token_async,
    start_runtime,
    stop_runtime,
    sync_runtime_workspace,
    wait_for_runtime_ready,
    warm_runtime_docker_network,
)
from app.store import AUDIT_LOG, PROFILE, RUNS, WORKSPACE
from app.transcription_catalog import list_transcription_catalog
from app.workflow_agents import (
    create_agent as create_workflow_agent,
    create_trigger as create_workflow_trigger,
    delete_agent as delete_workflow_agent,
    delete_trigger as delete_workflow_trigger,
    get_agent as get_workflow_agent,
    list_agents as list_workflow_agents,
    list_integration_capabilities as list_workflow_integration_capabilities,
    list_run_events as list_workflow_run_events,
    list_runs as list_workflow_runs,
    list_skill_capabilities as list_workflow_skill_capabilities,
    list_tool_capabilities as list_workflow_tool_capabilities,
    list_triggers as list_workflow_triggers,
    run_agent as run_workflow_agent,
    run_matching_triggers as run_matching_workflow_triggers,
    run_webhook_trigger,
    tick_due_schedule_triggers as tick_due_workflow_schedule_triggers,
    update_agent as update_workflow_agent,
    update_trigger as update_workflow_trigger,
)


APP_ROOT = Path(__file__).resolve().parent.parent
STATIC_ROOT = APP_ROOT / "static"
NOTEPAD_RECORDING_MAX_BYTES = int(os.getenv("VERXIO_NOTEPAD_RECORDING_MAX_BYTES", str(50 * 1024 * 1024)))
_AUDIO_MIME_EXTENSIONS = {
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/m4a": ".m4a",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/webm": ".webm",
    "audio/x-m4a": ".m4a",
    "audio/x-wav": ".wav",
    "video/webm": ".webm",
}


def _audio_extension_for_mime(mime_type: str) -> str:
    normalized = (mime_type or "").split(";", 1)[0].strip().lower()
    if normalized in _AUDIO_MIME_EXTENSIONS:
        return _AUDIO_MIME_EXTENSIONS[normalized]
    guessed = mimetypes.guess_extension(normalized)
    return guessed if guessed in {".aac", ".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav", ".webm"} else ".webm"


def _safe_recording_filename(file_name: str, mime_type: str) -> str:
    requested = Path(file_name or "notepad-recording").name
    stem = Path(requested).stem or "notepad-recording"
    safe_stem = re.sub(r"[^A-Za-z0-9._ -]+", "-", stem).strip(" ._-") or "notepad-recording"
    safe_stem = safe_stem[:120]
    return f"{safe_stem}{_audio_extension_for_mime(mime_type)}"


def _decode_recording_payload(payload: NotepadRecordingUploadRequest) -> tuple[bytes, str]:
    data_url = payload.data_url.strip()
    if not data_url.startswith("data:") or "," not in data_url:
        raise HTTPException(status_code=400, detail="Invalid audio payload.")

    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        raise HTTPException(status_code=400, detail="Audio payload must be base64 encoded.")

    header_mime_type = header[5:].split(";", 1)[0].strip().lower()
    mime_type = (payload.mime_type or header_mime_type or "audio/webm").split(";", 1)[0].strip().lower()
    if not (mime_type.startswith("audio/") or mime_type == "video/webm"):
        raise HTTPException(status_code=400, detail="Payload must be an audio recording.")

    try:
        audio_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Audio payload is not valid base64.") from exc

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")
    if len(audio_bytes) > NOTEPAD_RECORDING_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording is too large to save.")

    return audio_bytes, mime_type


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.run_migrations()

    # Never block accept() on docker.sock — a busy daemon after deploy would make
    # /api/health connection-refused until the probe finishes (or hangs).
    async def _warm() -> None:
        try:
            await warm_runtime_docker_network()
        except Exception:
            logging.getLogger(__name__).exception("Failed to warm runtime docker network cache")

    asyncio.create_task(_warm())
    yield


app = FastAPI(
    title="Verxio API",
    version="0.1.0",
    description="Verxio control plane for isolated Hermes Agent runtimes.",
    lifespan=lifespan,
)

cors_origins = [
    origin.strip()
    for origin in os.getenv("VERXIO_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
# Packaged Verxio Desktop loads from file:// and sends Origin: null.
if os.getenv("VERXIO_DESKTOP_CORS", "true").strip().lower() not in {"0", "false", "no", "off"}:
    if "null" not in cors_origins:
        cors_origins.append("null")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_ROOT), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_ROOT / "index.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "verxio-api"}


@app.get("/api/bootstrap", response_model=BootstrapResponse)
async def bootstrap(request: Request) -> BootstrapResponse:
    user = get_current_user(request)
    if user:
        workspace, profile, _runtime_instance = get_context_for_user(user)
    else:
        workspace, profile = WORKSPACE, PROFILE

    if is_hosted_control_plane():
        runtime = hosted_runtime_status()
        hermes = HermesRuntimeMetadata()
    else:
        adapter = HermesRuntimeAdapter()
        runtime = await adapter.status()
        hermes = await adapter.metadata() if runtime.configured else HermesRuntimeMetadata()
    return BootstrapResponse(
        workspace=workspace,
        profile=profile,
        audit_log=sorted(AUDIT_LOG, key=lambda event: event.created_at, reverse=True),
        runs=sorted(RUNS, key=lambda run: run.created_at, reverse=True),
        runtime=runtime,
        hermes=hermes,
    )


@app.post("/api/auth/signup", response_model=AuthCodeChallengeResponse)
async def signup_route(payload: SignupRequest) -> AuthCodeChallengeResponse:
    return signup(payload)


@app.post("/api/auth/verify-email", response_model=AuthResponse)
async def verify_email_route(payload: AuthCodeVerifyRequest, request: Request, response: Response) -> AuthResponse:
    return verify_email(payload, request, response)


@app.post("/api/auth/verification/resend", response_model=AuthCodeChallengeResponse)
async def resend_verification_route(payload: EmailRequest) -> AuthCodeChallengeResponse:
    return resend_verification(payload)


@app.post("/api/auth/login", response_model=AuthResponse)
async def login_route(payload: LoginRequest, request: Request, response: Response) -> AuthResponse:
    return login(payload, request, response)


@app.post("/api/auth/login/code/request", response_model=AuthCodeChallengeResponse)
async def request_login_code_route(payload: EmailRequest) -> AuthCodeChallengeResponse:
    return request_login_code(payload)


@app.post("/api/auth/login/code/verify", response_model=AuthResponse)
async def verify_login_code_route(
    payload: AuthCodeVerifyRequest,
    request: Request,
    response: Response,
) -> AuthResponse:
    return verify_login_code(payload, request, response)


@app.post("/api/auth/password/forgot", response_model=AuthCodeChallengeResponse)
async def forgot_password_route(payload: EmailRequest) -> AuthCodeChallengeResponse:
    return request_password_reset(payload)


@app.post("/api/auth/password/reset", response_model=AuthResponse)
async def reset_password_route(payload: PasswordResetRequest, request: Request, response: Response) -> AuthResponse:
    return reset_password(payload, request, response)


@app.post("/api/auth/logout")
async def logout_route(request: Request, response: Response) -> dict[str, bool]:
    return logout(request, response)


@app.get("/api/auth/me", response_model=AuthResponse)
async def me_route(request: Request) -> AuthResponse:
    user = require_user(request)
    return me(user)


@app.get("/api/profile")
async def get_profile(request: Request):
    user = get_current_user(request)
    if not user:
        return PROFILE
    _workspace, profile, _runtime_instance = get_context_for_user(user)
    return profile


@app.get("/api/hermes")
async def get_hermes_metadata():
    return await HermesRuntimeAdapter().metadata()


@app.get("/api/messaging/slack/manifest")
async def get_slack_manifest(
    request: Request,
    name: str | None = None,
    description: str | None = None,
    include_assistant: bool = True,
):
    require_user(request)
    try:
        return build_slack_manifest(
            name=name or "Verxio",
            description=description,
            include_assistant=include_assistant,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/runtime", response_model=RuntimeControlResponse)
async def get_runtime(request: Request) -> RuntimeControlResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    connected, detail = await runtime_health(runtime)
    return RuntimeControlResponse(runtime=runtime, connected=connected, detail=detail)


@app.post("/api/runtime/start", response_model=RuntimeControlResponse)
async def start_runtime_route(request: Request) -> RuntimeControlResponse:
    user = require_user(request)
    await _sync_composio_bridge_for_user(user)
    await _sync_postiz_bridge_for_user(user)
    await _sync_inference_bridge_for_user(user, refresh_running=True)
    runtime = await start_runtime(get_runtime_for_user(user), extra_env=runtime_env_for_user(str(user["id"])))
    connected, detail = await runtime_health(runtime)
    return RuntimeControlResponse(runtime=runtime, connected=connected, detail=detail)


@app.post("/api/runtime/stop", response_model=RuntimeControlResponse)
async def stop_runtime_route(request: Request) -> RuntimeControlResponse:
    user = require_user(request)
    runtime = stop_runtime(get_runtime_for_user(user))
    connected, detail = await runtime_health(runtime)
    return RuntimeControlResponse(runtime=runtime, connected=connected, detail=detail)


@app.post("/api/runtime/restart", response_model=RuntimeControlResponse)
async def restart_runtime_route(request: Request) -> RuntimeControlResponse:
    user = require_user(request)
    await _sync_composio_bridge_for_user(user)
    await _sync_postiz_bridge_for_user(user)
    await _sync_inference_bridge_for_user(user, refresh_running=True)
    runtime = await restart_runtime(get_runtime_for_user(user), extra_env=runtime_env_for_user(str(user["id"])))
    connected, detail = await runtime_health(runtime)
    return RuntimeControlResponse(runtime=runtime, connected=connected, detail=detail)


@app.post("/api/runtime/workspace", response_model=RuntimeControlResponse)
async def sync_runtime_workspace_route(
    request: Request, body: RuntimeWorkspaceSyncRequest
) -> RuntimeControlResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user, fresh=True)
    try:
        runtime = await sync_runtime_workspace(runtime, body.workspace_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    connected, detail = await runtime_health(runtime)
    return RuntimeControlResponse(runtime=runtime, connected=connected, detail=detail)


@app.get("/api/inference/catalog", response_model=InferenceCatalogResponse)
async def get_inference_catalog_route(request: Request) -> InferenceCatalogResponse:
    require_user(request)
    return list_inference_catalog()


@app.get("/api/inference/settings", response_model=InferenceSettings)
async def get_inference_settings_route(request: Request) -> InferenceSettings:
    user = require_user(request)
    return ensure_inference_settings(str(user["id"]))


@app.put("/api/inference/settings", response_model=InferenceSettings)
async def put_inference_settings_route(
    payload: InferenceSettingsUpdate, request: Request
) -> InferenceSettings:
    user = require_user(request)
    settings = update_inference_settings(str(user["id"]), payload)
    await _sync_inference_bridge_for_user(user, refresh_running=True)
    return settings


@app.get("/api/inference/usage", response_model=InferenceUsageResponse)
async def get_inference_usage_route(request: Request) -> InferenceUsageResponse:
    user = require_user(request)
    return inference_usage(str(user["id"]))


@app.get("/api/transcription/catalog", response_model=TranscriptionCatalogResponse)
async def get_transcription_catalog_route(request: Request, refresh: bool = False) -> TranscriptionCatalogResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    return await list_transcription_catalog(runtime, refresh=refresh)


@app.get("/api/artifacts", response_model=ArtifactListResponse)
async def list_artifacts(request: Request) -> ArtifactListResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    # Indexing walks the workspace and may docker-exec; keep it off the event loop
    # so a large React scaffold cannot wedge health/auth and return HTML 502 pages.
    artifacts = await asyncio.to_thread(index_artifacts, runtime)
    return ArtifactListResponse(artifacts=artifacts)


@app.post("/api/notepad/recordings", response_model=NotepadRecordingUploadResponse)
async def upload_notepad_recording(
    payload: NotepadRecordingUploadRequest, request: Request
) -> NotepadRecordingUploadResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    ensure_runtime_directories(runtime)

    audio_bytes, mime_type = _decode_recording_payload(payload)
    artifact_root = Path(runtime.artifact_path).resolve()
    recording_dir = (artifact_root / "notepad-recordings").resolve()
    recording_dir.mkdir(parents=True, exist_ok=True)

    file_name = _safe_recording_filename(payload.file_name, mime_type)
    target = (recording_dir / file_name).resolve()
    if not (target == recording_dir or recording_dir in target.parents):
        raise HTTPException(status_code=400, detail="Invalid recording path.")

    if target.exists():
        stem = target.stem
        suffix = target.suffix
        counter = 2
        while target.exists():
            target = (recording_dir / f"{stem}-{counter}{suffix}").resolve()
            counter += 1

    temp_path = target.with_name(f".{target.name}.tmp")
    temp_path.write_bytes(audio_bytes)
    temp_path.replace(target)

    relative_path = target.relative_to(artifact_root).as_posix()
    artifacts = await asyncio.to_thread(index_artifacts, runtime)
    artifact = next((record for record in artifacts if record.relative_path == relative_path), None)
    if artifact is None:
        raise HTTPException(status_code=500, detail="Recording was saved but could not be indexed.")

    return NotepadRecordingUploadResponse(artifact=artifact)


@app.get("/api/artifacts/{artifact_id}")
async def get_artifact(artifact_id: str, request: Request):
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    try:
        record, _path = artifact_file(runtime, artifact_id)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    return record


@app.delete("/api/artifacts/{artifact_id}")
async def delete_artifact(artifact_id: str, request: Request):
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    try:
        _record, path = artifact_file(runtime, artifact_id)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc

    try:
        path.unlink()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Artifact file is not writable.") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete artifact: {exc}") from exc

    db.execute(
        "DELETE FROM artifacts WHERE id = ? AND workspace_id = ? AND agent_id = ?",
        (artifact_id, runtime.workspace_id, runtime.agent_id),
    )

    return {"ok": True}


@app.get("/api/artifacts/{artifact_id}/preview")
async def preview_artifact(artifact_id: str, request: Request) -> FileResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    try:
        record, path = artifact_file(runtime, artifact_id)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    # Inline so browsers/img tags open a viewer instead of forcing a download.
    # Use /download when the client wants an attachment.
    return FileResponse(
        path,
        media_type=record.content_type,
        filename=record.file_name,
        content_disposition_type="inline",
    )


@app.get("/api/artifacts/{artifact_id}/download")
async def download_artifact(artifact_id: str, request: Request) -> FileResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    try:
        record, path = artifact_file(runtime, artifact_id)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    return FileResponse(
        path,
        media_type=record.content_type,
        filename=record.file_name,
        content_disposition_type="attachment",
    )


def _share_url(_request: Request, token: str) -> str:
    public_base = os.getenv("VERXIO_PUBLIC_WEB_URL", "").strip().rstrip("/")
    if not public_base:
        public_base = "http://127.0.0.1:8080"
    return f"{public_base}/share/notepad/{token}"


@app.get("/api/notepad", response_model=NotepadListResponse)
async def list_notepad_route(request: Request) -> NotepadListResponse:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return list_notepad(workspace, profile)


@app.post("/api/notepad/folders", response_model=NotepadFolderRecord)
async def create_notepad_folder_route(
    payload: NotepadFolderCreateRequest,
    request: Request,
) -> NotepadFolderRecord:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return create_folder(workspace, profile, payload)


@app.patch("/api/notepad/folders/{folder_id}", response_model=NotepadFolderRecord)
async def update_notepad_folder_route(
    folder_id: str,
    payload: NotepadFolderUpdateRequest,
    request: Request,
) -> NotepadFolderRecord:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return update_folder(workspace, profile, folder_id, payload)


@app.delete("/api/notepad/folders/{folder_id}")
async def delete_notepad_folder_route(folder_id: str, request: Request) -> dict[str, bool]:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return delete_folder(workspace, profile, folder_id)


@app.post("/api/notepad/notes", response_model=NotepadNoteRecord)
async def create_notepad_note_route(
    payload: NotepadNoteCreateRequest,
    request: Request,
) -> NotepadNoteRecord:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return create_note(workspace, profile, payload)


@app.patch("/api/notepad/notes/{note_id}", response_model=NotepadNoteRecord)
async def update_notepad_note_route(
    note_id: str,
    payload: NotepadNoteUpdateRequest,
    request: Request,
) -> NotepadNoteRecord:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return update_note(workspace, profile, note_id, payload)


@app.delete("/api/notepad/notes/{note_id}")
async def delete_notepad_note_route(note_id: str, request: Request) -> dict[str, bool]:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return delete_note(workspace, profile, note_id)


@app.post("/api/notepad/notes/{note_id}/summarize", response_model=NotepadNoteRecord)
async def summarize_notepad_note_route(note_id: str, request: Request) -> NotepadNoteRecord:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return await summarize_note(workspace, profile, note_id)


@app.post("/api/notepad/notes/{note_id}/share", response_model=NotepadShareResponse)
async def create_notepad_share_route(note_id: str, request: Request) -> NotepadShareResponse:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return create_share(workspace, profile, note_id, lambda token: _share_url(request, token))


@app.delete("/api/notepad/notes/{note_id}/share")
async def revoke_notepad_share_route(note_id: str, request: Request) -> dict[str, bool]:
    from app.runtime_auth import get_context_for_request

    workspace, profile, _runtime_instance = get_context_for_request(request)
    return revoke_share(workspace, profile, note_id)


@app.get("/api/public/notepad/{token}", response_model=PublicNotepadShareResponse)
async def public_notepad_share_route(token: str) -> PublicNotepadShareResponse:
    return public_share(token)


@app.get("/api/pulse/webhooks/meta", include_in_schema=False)
async def verify_meta_pulse_webhook(request: Request) -> Response:
    return verify_challenge(request)


@app.post("/api/pulse/webhooks/meta", response_model=PulseWebhookIngestResponse)
async def ingest_meta_pulse_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> PulseWebhookIngestResponse:
    return await ingest_meta_webhook(request, background_tasks)


@app.get("/api/pulse/webhooks/whatsapp", include_in_schema=False)
async def verify_whatsapp_pulse_webhook(request: Request) -> Response:
    return verify_challenge(request)


@app.post("/api/pulse/webhooks/whatsapp", response_model=PulseWebhookIngestResponse)
async def ingest_whatsapp_pulse_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> PulseWebhookIngestResponse:
    return await ingest_whatsapp_webhook(request, background_tasks)


@app.post("/api/pulse/webhooks/tiktok", response_model=PulseWebhookIngestResponse)
async def ingest_tiktok_pulse_webhook() -> PulseWebhookIngestResponse:
    raise HTTPException(status_code=409, detail="TikTok Business Messaging is partner-gated.")


@app.post("/api/pulse/webhooks/linkedin", response_model=PulseWebhookIngestResponse)
async def ingest_linkedin_pulse_webhook() -> PulseWebhookIngestResponse:
    raise HTTPException(status_code=409, detail="LinkedIn messaging APIs are partner-gated.")


@app.get("/api/workflow-agents", response_model=WorkflowAgentsResponse)
async def list_workflow_agents_route(request: Request) -> WorkflowAgentsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_workflow_agents(workspace, profile)


@app.get("/api/workflow-agents/capabilities/skills", response_model=WorkflowSkillCapabilitiesResponse)
async def list_workflow_skill_capabilities_route(request: Request) -> WorkflowSkillCapabilitiesResponse:
    require_user(request)
    return await list_workflow_skill_capabilities()


@app.get("/api/workflow-agents/capabilities/tools", response_model=WorkflowToolCapabilitiesResponse)
async def list_workflow_tool_capabilities_route(request: Request) -> WorkflowToolCapabilitiesResponse:
    require_user(request)
    return await list_workflow_tool_capabilities()


@app.get("/api/workflow-agents/capabilities/integrations", response_model=WorkflowIntegrationCapabilitiesResponse)
async def list_workflow_integration_capabilities_route(request: Request) -> WorkflowIntegrationCapabilitiesResponse:
    user = require_user(request)
    return list_workflow_integration_capabilities(str(user["id"]))


@app.get("/api/knowledge-bases", response_model=KnowledgeBasesResponse)
async def list_knowledge_bases_route(request: Request) -> KnowledgeBasesResponse:
    user = require_user(request)
    workspace, _profile, _runtime_instance = get_context_for_user(user)
    return list_knowledge_bases(workspace)


@app.post("/api/knowledge-bases", response_model=KnowledgeBaseRecord)
async def create_knowledge_base_route(
    payload: KnowledgeBaseCreateRequest,
    request: Request,
) -> KnowledgeBaseRecord:
    user = require_user(request)
    workspace, _profile, _runtime_instance = get_context_for_user(user)
    return create_knowledge_base(workspace, payload)


@app.delete("/api/knowledge-bases/{knowledge_base_id}")
async def delete_knowledge_base_route(knowledge_base_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, _profile, _runtime_instance = get_context_for_user(user)
    return delete_knowledge_base(workspace, knowledge_base_id)


@app.get("/api/knowledge-bases/{knowledge_base_id}/documents", response_model=KnowledgeDocumentsResponse)
async def list_knowledge_documents_route(knowledge_base_id: str, request: Request) -> KnowledgeDocumentsResponse:
    user = require_user(request)
    workspace, _profile, _runtime_instance = get_context_for_user(user)
    return list_knowledge_documents(workspace, knowledge_base_id)


@app.post("/api/knowledge-bases/{knowledge_base_id}/documents", response_model=KnowledgeDocumentRecord)
async def create_knowledge_document_route(
    knowledge_base_id: str,
    payload: KnowledgeDocumentCreateRequest,
    request: Request,
) -> KnowledgeDocumentRecord:
    user = require_user(request)
    workspace, _profile, _runtime_instance = get_context_for_user(user)
    return create_knowledge_document(workspace, knowledge_base_id, payload)


@app.post("/api/workflow-agents", response_model=WorkflowAgentRecord)
async def create_workflow_agent_route(
    payload: WorkflowAgentCreateRequest,
    request: Request,
) -> WorkflowAgentRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return create_workflow_agent(workspace, profile, payload)


@app.get("/api/workflow-agents/{agent_id}", response_model=WorkflowAgentRecord)
async def get_workflow_agent_route(agent_id: str, request: Request) -> WorkflowAgentRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return get_workflow_agent(workspace, profile, agent_id)


@app.put("/api/workflow-agents/{agent_id}", response_model=WorkflowAgentRecord)
async def update_workflow_agent_route(
    agent_id: str,
    payload: WorkflowAgentUpdateRequest,
    request: Request,
) -> WorkflowAgentRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return update_workflow_agent(workspace, profile, agent_id, payload)


@app.delete("/api/workflow-agents/{agent_id}")
async def delete_workflow_agent_route(agent_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return delete_workflow_agent(workspace, profile, agent_id)


@app.get("/api/workflow-agents/{agent_id}/triggers", response_model=WorkflowTriggersResponse)
async def list_workflow_triggers_route(agent_id: str, request: Request) -> WorkflowTriggersResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_workflow_triggers(workspace, profile, agent_id, request)


@app.post("/api/workflow-agents/{agent_id}/triggers", response_model=WorkflowTriggerRecord)
async def create_workflow_trigger_route(
    agent_id: str,
    payload: WorkflowTriggerCreateRequest,
    request: Request,
) -> WorkflowTriggerRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return create_workflow_trigger(workspace, profile, agent_id, payload, request)


@app.put("/api/workflow-agents/{agent_id}/triggers/{trigger_id}", response_model=WorkflowTriggerRecord)
async def update_workflow_trigger_route(
    agent_id: str,
    trigger_id: str,
    payload: WorkflowTriggerUpdateRequest,
    request: Request,
) -> WorkflowTriggerRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return update_workflow_trigger(workspace, profile, agent_id, trigger_id, payload, request)


@app.delete("/api/workflow-agents/{agent_id}/triggers/{trigger_id}")
async def delete_workflow_trigger_route(agent_id: str, trigger_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return delete_workflow_trigger(workspace, profile, agent_id, trigger_id)


@app.get("/api/workflow-agents/{agent_id}/runs", response_model=WorkflowRunsResponse)
async def list_workflow_runs_route(agent_id: str, request: Request, limit: int = 50) -> WorkflowRunsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_workflow_runs(workspace, profile, agent_id, limit)


@app.get("/api/workflow-agents/{agent_id}/runs/{run_id}/events", response_model=WorkflowRunEventsResponse)
async def list_workflow_run_events_route(agent_id: str, run_id: str, request: Request) -> WorkflowRunEventsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_workflow_run_events(workspace, profile, agent_id, run_id)


@app.post("/api/workflow-agents/{agent_id}/runs", response_model=WorkflowRunRecord)
async def run_workflow_agent_route(
    agent_id: str,
    payload: WorkflowRunCreateRequest,
    request: Request,
) -> WorkflowRunRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return await run_workflow_agent(workspace, profile, agent_id, payload)


@app.post("/api/workflow-agents/triggers/api", response_model=WorkflowTriggerRunsResponse)
async def run_workflow_api_triggers_route(
    payload: WorkflowTriggerRunRequest,
    request: Request,
) -> WorkflowTriggerRunsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return await run_matching_workflow_triggers(workspace, profile, "api", payload.event_name, payload.input)


@app.post("/api/workflow-agents/triggers/chat", response_model=WorkflowTriggerRunsResponse)
async def run_workflow_chat_triggers_route(
    payload: WorkflowTriggerRunRequest,
    request: Request,
) -> WorkflowTriggerRunsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return await run_matching_workflow_triggers(workspace, profile, "chat", payload.event_name, payload.input)


@app.post("/api/workflow-agents/triggers/app-events", response_model=WorkflowTriggerRunsResponse)
async def run_workflow_app_event_triggers_route(
    payload: WorkflowTriggerRunRequest,
    request: Request,
) -> WorkflowTriggerRunsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return await run_matching_workflow_triggers(workspace, profile, "app_event", payload.event_name, payload.input)


@app.post("/api/workflow-agents/triggers/schedules/tick", response_model=WorkflowTriggerRunsResponse)
async def tick_workflow_schedule_triggers_route(request: Request) -> WorkflowTriggerRunsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return await tick_due_workflow_schedule_triggers(workspace, profile)


@app.post("/api/workflow-webhooks/{trigger_id}", response_model=WorkflowWebhookIngestResponse)
async def ingest_workflow_webhook_route(trigger_id: str, request: Request) -> WorkflowWebhookIngestResponse:
    secret = request.headers.get("X-Verxio-Webhook-Secret") or request.query_params.get("secret") or ""
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid workflow webhook JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Workflow webhook payload must be an object.")
    run = await run_webhook_trigger(trigger_id, secret, payload)
    return WorkflowWebhookIngestResponse(run=run)


@app.get("/api/pulse/channels", response_model=PulseChannelsResponse)
async def list_pulse_channels_route(request: Request) -> PulseChannelsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_pulse_channels(workspace, profile)


@app.post("/api/pulse/channels", response_model=PulseChannelRecord)
async def create_pulse_channel_route(
    payload: PulseChannelCreateRequest,
    request: Request,
) -> PulseChannelRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return create_pulse_channel(workspace, profile, payload)


@app.post("/api/pulse/channels/connect", response_model=PulseChannelConnectResponse)
async def connect_pulse_channel_route(
    payload: PulseChannelConnectRequest,
    request: Request,
) -> PulseChannelConnectResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return connect_channel(workspace, profile, payload)


@app.post("/api/pulse/channels/meta/complete", response_model=PulseMetaOAuthCompleteResponse)
async def complete_pulse_meta_oauth_route(
    payload: PulseMetaOAuthCompleteRequest,
    request: Request,
) -> PulseMetaOAuthCompleteResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return await complete_meta_oauth(workspace, profile, payload)


@app.get("/api/pulse/channels/capabilities")
async def get_pulse_channel_capabilities_route(request: Request):
    require_user(request)
    return {"capabilityMatrix": channel_capability_matrix()}


@app.delete("/api/pulse/channels/{channel_id}")
async def delete_pulse_channel_route(channel_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return delete_pulse_channel(workspace, profile, channel_id)


@app.get("/api/pulse/conversations", response_model=PulseConversationsResponse)
async def list_pulse_conversations_route(request: Request) -> PulseConversationsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_pulse_conversations(workspace, profile)


@app.get("/api/pulse/conversations/{conversation_id}", response_model=PulseConversationDetailResponse)
async def get_pulse_conversation_route(
    conversation_id: str,
    request: Request,
) -> PulseConversationDetailResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return get_pulse_conversation_detail(workspace, profile, conversation_id)


@app.post("/api/pulse/conversations/{conversation_id}/messages", response_model=PulseMessageRecord)
async def send_pulse_message_route(
    conversation_id: str,
    payload: PulseSendMessageRequest,
    request: Request,
) -> PulseMessageRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return send_pulse_human_message(workspace, profile, conversation_id, payload)


@app.post("/api/pulse/conversations/{conversation_id}/state", response_model=PulseConversationRecord)
async def update_pulse_conversation_state_route(
    conversation_id: str,
    payload: PulseConversationStateRequest,
    request: Request,
) -> PulseConversationRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return update_pulse_conversation_state(workspace, profile, conversation_id, payload)


@app.get("/api/pulse/automations", response_model=PulseAutomationListResponse)
async def list_pulse_automations_route(request: Request) -> PulseAutomationListResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_pulse_automations(workspace, profile)


@app.post("/api/pulse/automations", response_model=PulseAutomationRecord)
async def create_pulse_automation_route(
    payload: PulseAutomationCreateRequest,
    request: Request,
) -> PulseAutomationRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return create_pulse_automation(workspace, profile, payload)


@app.put("/api/pulse/automations/{automation_id}", response_model=PulseAutomationRecord)
async def update_pulse_automation_route(
    automation_id: str,
    payload: PulseAutomationUpdateRequest,
    request: Request,
) -> PulseAutomationRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return update_pulse_automation(workspace, profile, automation_id, payload)


@app.delete("/api/pulse/automations/{automation_id}")
async def delete_pulse_automation_route(automation_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return delete_pulse_automation(workspace, profile, automation_id)


@app.post("/api/pulse/automations/{automation_id}/enable", response_model=PulseAutomationRecord)
async def enable_pulse_automation_route(
    automation_id: str,
    payload: PulseAutomationToggleRequest,
    request: Request,
) -> PulseAutomationRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return toggle_pulse_automation(workspace, profile, automation_id, payload)


@app.post("/api/pulse/automations/generate", response_model=PulseAutomationRecord)
async def generate_pulse_automation_route(
    payload: PulseAutomationGenerateRequest,
    request: Request,
) -> PulseAutomationRecord:
    require_user(request)
    return generated_flow_from_prompt(payload)


@app.post("/api/pulse/automations/simulate", response_model=PulseAutomationSimulateResponse)
async def simulate_pulse_automation_route(
    payload: PulseAutomationSimulateRequest,
    request: Request,
) -> PulseAutomationSimulateResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return simulate_pulse_automation(workspace, profile, payload)


@app.get("/api/pulse/tags", response_model=PulseTagsResponse)
async def list_pulse_tags_route(request: Request) -> PulseTagsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_pulse_tags(workspace, profile)


@app.get("/api/pulse/analytics", response_model=PulseAnalyticsResponse)
async def get_pulse_analytics_route(request: Request) -> PulseAnalyticsResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return pulse_analytics(workspace, profile)


@app.post("/api/pulse/internal/tick")
async def tick_pulse_route(request: Request) -> dict[str, int]:
    require_user(request)
    return tick_pulse_due_runs()


async def _sync_composio_bridge_for_user(user: dict, *, apply_live: bool = False, allow_restart: bool = True):
    """Sync Composio → Hermes MCP config without bouncing the UI.

    - Always writes/updates the runtime config bridge when needed.
    - Soft-reloads MCP in the live dashboard when connections change.
    - Only Docker-restarts when COMPOSIO_API_KEY is missing from the container
      (cannot hot-inject env vars).
    """
    runtime = get_runtime_for_user(user, fresh=True)

    def _prepare() -> tuple:
        accounts = list_composio_accounts(str(user["id"]))
        bridge = sync_composio_runtime_bridge(runtime, str(user["id"]), accounts)
        composio_api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
        # docker inspect must not run on the event loop — it freezes health/auth.
        runtime_env_changed = (
            bridge.enabled
            and bool(composio_api_key)
            and runtime.status == "running"
            and not runtime_container_env_matches(runtime, "COMPOSIO_API_KEY", composio_api_key)
        )
        return accounts, bridge, runtime_env_changed

    accounts, bridge, runtime_env_changed = await asyncio.to_thread(_prepare)

    if allow_restart and runtime.status == "running" and runtime_env_changed:
        # Env injection requires a new container. Rare — only when the platform
        # key was added after the runtime was already started.
        await restart_runtime(runtime, extra_env=runtime_env_for_user(str(user["id"])))
    elif apply_live and runtime.status in {"running", "starting"} and (bridge.changed or bridge.enabled):
        # Soft-reload whenever the bridge is live — not only when config bytes
        # changed. Prod sessions often already have the MCP URL on disk but a
        # stale Connected Apps prompt / toolset until reload runs (local feels
        # fine because Skills → Connections usually forced a change).
        await soft_reload_runtime_mcp(runtime)

    return accounts, bridge


async def _sync_postiz_bridge_for_user(user: dict, *, apply_live: bool = False, allow_restart: bool = True):
    """Sync Postiz MCP bridge and inject runtime env when the workspace binding is active."""

    runtime = get_runtime_for_user(user, fresh=True)

    def _prepare() -> tuple:
        bridge = sync_postiz_runtime_bridge(runtime)
        postiz_env = runtime_env_for_workspace(runtime.workspace_id)
        runtime_env_changed = (
            bridge.enabled
            and runtime.status == "running"
            and any(
                not runtime_container_env_matches(runtime, key, value)
                for key, value in postiz_env.items()
            )
        )
        return bridge, runtime_env_changed

    bridge, runtime_env_changed = await asyncio.to_thread(_prepare)

    if allow_restart and runtime.status == "running" and runtime_env_changed:
        await restart_runtime(runtime, extra_env=runtime_env_for_user(str(user["id"])))
    elif apply_live and runtime.status in {"running", "starting"} and (bridge.changed or bridge.enabled):
        await soft_reload_runtime_mcp(runtime)

    return bridge


async def _sync_inference_bridge_for_user(
    user: dict,
    *,
    refresh_running: bool = False,
    allow_restart: bool = True,
):
    runtime = get_runtime_for_user(user, fresh=True)

    def _prepare() -> tuple:
        bridge = sync_inference_runtime_bridge(runtime, str(user["id"]))
        runtime_env = runtime_env_for_user(str(user["id"]))
        # docker inspect must not run on the event loop — it freezes health/auth.
        # Hosted mode: restart when injected secrets drift.
        # BYOK mode: bridge.enabled is false, but bridge.changed means we
        # stripped leftover hosted Qwen/Gemini — still restart so the container
        # drops DASHSCOPE/GEMINI injected from the previous hosted session.
        runtime_env_changed = (
            runtime.status == "running"
            and (
                (
                    bridge.enabled
                    and any(
                        not runtime_container_env_matches(runtime, key, value)
                        for key, value in runtime_env.items()
                    )
                )
                or (not bridge.enabled and bridge.mode == "byok" and bridge.changed)
            )
        )
        return bridge, runtime_env, runtime_env_changed

    bridge, runtime_env, runtime_env_changed = await asyncio.to_thread(_prepare)

    if allow_restart and runtime.status == "running" and (runtime_env_changed or (refresh_running and bridge.changed)):
        await restart_runtime(runtime, extra_env=runtime_env)

    return bridge


@app.get("/api/composio/connections", response_model=ComposioConnectionsResponse)
async def list_composio_connections_route(request: Request) -> ComposioConnectionsResponse:
    user = require_user(request)
    accounts, bridge = await _sync_composio_bridge_for_user(user, apply_live=True)
    return ComposioConnectionsResponse(
        accounts=accounts,
        configured=is_composio_configured(),
        toolBridge=bridge,
    )


@app.get("/api/composio/connections/apps", response_model=ComposioAppsResponse)
async def list_composio_apps_route(request: Request) -> ComposioAppsResponse:
    require_user(request)
    apps = list_composio_apps()
    return ComposioAppsResponse(
        apps=apps,
        configured=is_composio_configured(),
        catalogReady=is_composio_catalog_ready(),
        catalogError=get_composio_catalog_error(),
    )


@app.get("/api/composio/connections/apps/{app_slug}/tools", response_model=ComposioAppToolsResponse)
async def list_composio_app_tools_route(
    app_slug: str, request: Request, limit: int = 4
) -> ComposioAppToolsResponse:
    require_user(request)
    return ComposioAppToolsResponse(
        tools=list_composio_app_tools(app_slug, limit=limit),
        configured=is_composio_configured(),
        catalogReady=is_composio_catalog_ready(),
        catalogError=get_composio_catalog_error(),
    )


@app.get(
    "/api/composio/connections/apps/{app_slug}/setup",
    response_model=ComposioConnectionSetupResponse,
)
async def get_composio_connection_setup_route(
    app_slug: str, request: Request
) -> ComposioConnectionSetupResponse:
    require_user(request)
    return get_composio_connection_setup(app_slug)


@app.post("/api/composio/connections/initiate", response_model=ComposioInitiateResponse)
async def initiate_composio_connection_route(
    payload: ComposioInitiateRequest, request: Request
) -> ComposioInitiateResponse:
    user = require_user(request)
    return initiate_composio_connection(str(user["id"]), payload.appSlug, payload.callbackUrl)


@app.post(
    "/api/composio/connections/complete",
    response_model=ComposioCompleteConnectionResponse,
)
async def complete_composio_connection_route(
    payload: ComposioCompleteConnectionRequest, request: Request
) -> ComposioCompleteConnectionResponse:
    user = require_user(request)
    result = complete_composio_connection(str(user["id"]), payload.appSlug, payload.credentials)
    await _sync_composio_bridge_for_user(user, apply_live=True)
    return result


@app.delete("/api/composio/connections/{account_id}")
async def delete_composio_connection_route(account_id: str, request: Request) -> dict[str, str]:
    user = require_user(request)
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required.")
    if not is_composio_configured():
        raise HTTPException(status_code=500, detail="Composio is not configured.")
    result = delete_composio_account(account_id)
    await _sync_composio_bridge_for_user(user, apply_live=True)
    return result


def _postiz_status_response(
    *,
    binding,
    bridge,
    channel_count: int = 0,
    health: dict[str, Any] | None = None,
) -> PostizStatusResponse:
    from app.postiz import public_url as postiz_public_url

    return PostizStatusResponse(
        configured=is_postiz_configured(),
        publicUrl=postiz_public_url(),
        channelCount=channel_count,
        health=health or {},
        binding=binding,
        toolBridge=bridge,
    )


@app.get("/api/postiz/status", response_model=PostizStatusResponse)
async def get_postiz_status_route(request: Request) -> PostizStatusResponse:
    user = require_user(request)
    workspace, _profile, runtime = get_context_for_user(user)
    binding = get_postiz_binding(workspace.id)
    bridge = await _sync_postiz_bridge_for_user(user, apply_live=True)
    channel_count = 0
    if binding and binding.status == "active":
        try:
            channel_count = len(extract_postiz_integrations(postiz_public_v1_json(workspace.id, "GET", "integrations")))
        except HTTPException:
            channel_count = 0
    return _postiz_status_response(
        binding=binding,
        bridge=bridge,
        channel_count=channel_count,
        health=postiz_health() if is_postiz_configured() else {"ok": False, "status": "disabled"},
    )


@app.post("/api/postiz/enable", response_model=PostizStatusResponse)
async def enable_postiz_route(request: Request) -> PostizStatusResponse:
    user = require_user(request)
    workspace, profile, runtime = get_context_for_user(user)
    binding = enable_postiz_for_workspace(workspace, profile, runtime)
    bridge = await _sync_postiz_bridge_for_user(user, apply_live=True)
    return _postiz_status_response(binding=binding, bridge=bridge)


@app.post("/api/postiz/disable", response_model=PostizStatusResponse)
async def disable_postiz_route(request: Request) -> PostizStatusResponse:
    user = require_user(request)
    workspace, _profile, runtime = get_context_for_user(user)
    binding = disable_postiz_for_workspace(workspace.id, runtime)
    bridge = await _sync_postiz_bridge_for_user(user, apply_live=True)
    return _postiz_status_response(binding=binding, bridge=bridge)


@app.get("/api/postiz/calendar-session")
async def get_postiz_calendar_session_route(request: Request) -> dict:
    """Return the browser URL for the Postiz calendar (Dialog / new window)."""
    user = require_user(request)
    workspace, _profile, _runtime = get_context_for_user(user)
    from app.postiz import public_url as postiz_public_url

    binding = get_postiz_binding(workspace.id)
    if not binding or binding.status not in {"active", "needs_api_key"}:
        raise HTTPException(status_code=400, detail="Enable Socials before opening the calendar.")
    return {
        "ok": True,
        "url": request.url_for("open_postiz_calendar_route").path,
        "publicUrl": postiz_public_url(),
    }


@app.get("/api/postiz/calendar-open")
async def open_postiz_calendar_route(request: Request) -> RedirectResponse:
    user = require_user(request)
    workspace, _profile, _runtime = get_context_for_user(user)
    from app.postiz import public_url as postiz_public_url

    binding = get_postiz_binding(workspace.id)
    if not binding or binding.status not in {"active", "needs_api_key"}:
        raise HTTPException(status_code=400, detail="Enable Socials before opening the calendar.")

    target = postiz_public_url()
    session = postiz_browser_session_for_workspace(workspace.id)
    response = RedirectResponse(url=target, status_code=302)

    parsed_target = urlparse(target)
    target_host = parsed_target.hostname or ""
    secure = parsed_target.scheme == "https"
    same_site = "none" if secure else "lax"
    request_host = request.url.hostname or ""
    cookie_domain = target_host if target_host and request_host and target_host != request_host else None

    for name, value in session.items():
        response.set_cookie(
            name,
            value,
            domain=cookie_domain,
            httponly=True,
            secure=secure,
            samesite=same_site,
            path="/",
        )

    return response


@app.get("/api/postiz/integrations")
async def list_postiz_integrations_route(request: Request) -> dict:
    user = require_user(request)
    workspace, _profile, _runtime = get_context_for_user(user)
    payload = postiz_public_v1_json(workspace.id, "GET", "integrations")
    return {"integrations": extract_postiz_integrations(payload)}


@app.delete("/api/postiz/integrations/{integration_id}")
async def delete_postiz_integration_route(integration_id: str, request: Request) -> dict:
    user = require_user(request)
    workspace, _profile, _runtime = get_context_for_user(user)
    payload = postiz_public_v1_json(workspace.id, "DELETE", f"integrations/{integration_id}")
    return {"ok": True, "result": payload}


@app.get("/api/postiz/posts")
async def list_postiz_posts_route(request: Request) -> dict:
    user = require_user(request)
    workspace, _profile, _runtime = get_context_for_user(user)
    payload = postiz_public_v1_json(workspace.id, "GET", "posts", params=dict(request.query_params))
    return {"posts": extract_postiz_posts(payload)}


@app.post("/api/postiz/connect-url")
async def create_postiz_connect_url_route(request: Request) -> dict:
    user = require_user(request)
    workspace, _profile, _runtime = get_context_for_user(user)
    body = await request.json()
    provider = str(body.get("provider") or "").strip()
    if not provider:
        raise HTTPException(status_code=400, detail="provider is required.")
    payload = postiz_public_v1_json(workspace.id, "GET", f"social/{provider}")
    if isinstance(payload, str):
        url = payload.strip()
        if url:
            return {"url": url}
    if isinstance(payload, dict):
        candidates = [payload, payload.get("data"), payload.get("result")]
        for candidate in candidates:
            if isinstance(candidate, dict):
                url = str(candidate.get("url") or "").strip()
                if url:
                    return {"url": url}

    provider_name = {
        "x": "X",
        "linkedin": "LinkedIn",
        "linkedin-page": "LinkedIn",
    }.get(provider, provider)
    raise HTTPException(
        status_code=409,
        detail=(
            f"{provider_name} OAuth is not configured in this self-hosted Postiz instance. "
            f"Add the provider credentials to the Postiz environment and restart Postiz."
        ),
    )


@app.api_route(
    "/api/postiz/v1/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def proxy_postiz_v1_route(path: str, request: Request) -> Response:
    user = require_user(request)
    workspace, _profile, _runtime = get_context_for_user(user)

    json_body: Any | None = None
    content: bytes | None = None
    headers: dict[str, str] = {}
    content_type = request.headers.get("content-type", "")
    if content_type:
        headers["Content-Type"] = content_type

    if request.method in {"POST", "PUT", "PATCH"}:
        if "application/json" in content_type.lower():
            try:
                json_body = await request.json()
            except Exception as exc:
                raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc
        else:
            content = await request.body()

    upstream = postiz_public_v1_request(
        workspace.id,
        request.method,
        path,
        params=dict(request.query_params),
        json_body=json_body,
        content=content,
        headers=headers,
    )
    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in {"content-encoding", "transfer-encoding", "connection"}
    }
    return Response(content=upstream.content, status_code=upstream.status_code, headers=response_headers)


@app.get("/api/leash/agent-config")
async def get_leash_agent_config(request: Request) -> dict:
    """Read Leash agent.json from the runtime volume. Pass-through cache only — never stored in Turso."""
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    ensure_runtime_directories(runtime)
    payload = read_leash_agent(runtime)
    if payload is None:
        raise HTTPException(status_code=404, detail="Leash agent config not found.")
    return {"ok": True, "config": payload}


@app.put("/api/leash/agent-config")
async def put_leash_agent_config(request: Request) -> dict[str, bool]:
    """Write Leash agent.json to the runtime volume from the browser. Body is not logged or persisted in Turso."""
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    ensure_runtime_directories(runtime)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body.") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Leash agent config must be a JSON object.")
    write_leash_agent(runtime, body)
    return {"ok": True}


@app.delete("/api/leash/agent-config")
async def delete_leash_agent_config(request: Request) -> dict[str, bool]:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    clear_leash_agent(runtime)
    return {"ok": True}


def _runtime_dashboard_token(runtime_id: str, runtime: RuntimeInstance | None = None, *, prefer_live: bool = False) -> str:
    row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime_id,))
    db_token = str(row.get("dashboard_token") or "") if row else ""
    token = db_token
    # Live docker inspect is expensive and blocks the event loop when called
    # sync. HTTP status polling must use the DB token; WS may prefer live.
    if prefer_live and runtime is not None:
        live = runtime_live_dashboard_token(runtime, fallback="")
        if live:
            if db_token and live != db_token:
                logger.warning(
                    "Runtime dashboard token mismatch runtime_id=%s; using live container token",
                    runtime_id,
                )
                db.execute(
                    "UPDATE runtime_instances SET dashboard_token = ? WHERE id = ?",
                    (live, runtime_id),
                )
            token = live
    if not token:
        raise HTTPException(status_code=503, detail="Runtime dashboard token is not ready.")
    return token


async def _runtime_dashboard_token_async(
    runtime_id: str,
    runtime: RuntimeInstance,
    *,
    prefer_live: bool = False,
) -> str:
    row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime_id,))
    db_token = str(row.get("dashboard_token") or "") if row else ""
    token = db_token
    if prefer_live:
        live = await runtime_live_dashboard_token_async(runtime, fallback="")
        if live:
            if db_token and live != db_token:
                logger.warning(
                    "Runtime dashboard token mismatch runtime_id=%s; using live container token",
                    runtime_id,
                )
                db.execute(
                    "UPDATE runtime_instances SET dashboard_token = ? WHERE id = ?",
                    (live, runtime_id),
                )
            token = live
    if not token:
        raise HTTPException(status_code=503, detail="Runtime dashboard token is not ready.")
    return token


def _proxy_headers(request: Request, token: str) -> dict[str, str]:
    blocked = {"host", "cookie", "authorization", "x-hermes-session-token"}
    headers = {key: value for key, value in request.headers.items() if key.lower() not in blocked}
    headers["X-Hermes-Session-Token"] = token
    headers["Authorization"] = f"Bearer {token}"
    return headers


def _dashboard_request_is_read(method: str) -> bool:
    return method.upper() in {"GET", "HEAD", "OPTIONS"}


def _dashboard_path_is_lightweight(path: str) -> bool:
    normalized = path.strip("/")
    # api/model/options builds a priced/capabilities catalog and routinely
    # exceeds the 2s lightweight proxy budget — treating it as lightweight
    # made BYOK connect look "green" (status) while the model selector stayed
    # on "no model" until a later lucky refetch.
    return normalized in {
        "api/status",
        "api/config",
        "api/sessions",
        "api/models",
        "api/model/info",
    }


def _dashboard_path_needs_inference_sync(path: str) -> bool:
    """Model reads need the hosted default written into Hermes config.yaml.

    Fresh runtimes ship without a model section, so GET /api/model/info returns
    empty until sync_inference_runtime_bridge runs. Status/config polls stay
    lightweight; only model endpoints pay for this seed.
    """
    normalized = path.strip("/")
    return normalized in {"api/model/info", "api/model/options"}


def _dashboard_path_needs_inference_env_reassert(path: str, method: str) -> bool:
    """Dashboard env writes can drop Verxio-injected hosted model env vars.

    Hermes' `/api/env/reload` mirrors `.env` into `os.environ` and removes keys
    absent from `.env`. Hosted inference secrets are intentionally injected as
    container env, not persisted into `.env`, so a generic Tools & Keys reload
    can make the running gateway process forget `DASHSCOPE_API_KEY` while
    `config.yaml` still selects `provider: alibaba`.
    """
    if _dashboard_request_is_read(method):
        return False

    normalized = path.strip("/")
    return normalized in {
        "api/env",
        "api/env/reload",
        "api/runtime/restart",
    } or (
        normalized.startswith("api/tools/toolsets/")
        and (normalized.endswith("/env") or normalized.endswith("/provider"))
    )


_ENSURE_TASKS: set[asyncio.Task[None]] = set()
_BRIDGE_TASKS: set[asyncio.Task[None]] = set()


def _track_background_task(task: asyncio.Task[None], bucket: set[asyncio.Task[None]]) -> None:
    bucket.add(task)
    task.add_done_callback(bucket.discard)


def _schedule_inference_bridge_sync(user: dict) -> None:
    async def _run() -> None:
        try:
            await _sync_inference_bridge_for_user(user, allow_restart=False)
        except Exception:
            logger.exception("Background inference bridge sync failed")

    _track_background_task(asyncio.create_task(_run()), _BRIDGE_TASKS)


def _schedule_runtime_ensure(user: dict) -> None:
    """Kick container ensure off the request path (status polls must stay instant)."""

    async def _run() -> None:
        try:
            runtime = await start_runtime(
                get_runtime_for_user(user),
                extra_env=runtime_env_for_user(str(user["id"])),
                wait_ready=False,
            )
            # Finish ready-wait in the background so WS can connect once Hermes is up.
            if runtime.status != "running":
                await wait_for_runtime_ready(runtime, timeout_seconds=90)
        except Exception:
            logger.exception("Background runtime ensure failed")

    _track_background_task(asyncio.create_task(_run()), _ENSURE_TASKS)


logger = logging.getLogger(__name__)


@app.api_route(
    "/api/runtime/dashboard/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def proxy_runtime_dashboard(path: str, request: Request) -> Response:
    user = require_user(request)
    lightweight = _dashboard_request_is_read(request.method) and _dashboard_path_is_lightweight(path)

    # Reads must stay fast for boot polling. Bridge sync belongs on writes and
    # the websocket background task — never on every status/config/sessions GET.
    # Exception: model info/options must seed Hermes with the user's hosted
    # default first, or the statusbar paints "No model" on a fresh runtime.
    if not _dashboard_request_is_read(request.method):
        await _sync_composio_bridge_for_user(user, apply_live=True)
        await _sync_inference_bridge_for_user(user)
    elif _dashboard_path_needs_inference_sync(path):
        if lightweight:
            _schedule_inference_bridge_sync(user)
        else:
            await _sync_inference_bridge_for_user(user, allow_restart=False)

    # Lightweight GETs never call start_runtime. Refresh was paying a full
    # ensure/health tax on every status poll and felt like a cold start.
    if lightweight:
        runtime = get_runtime_for_user(user)
        if runtime.status != "running":
            _schedule_runtime_ensure(user)
    else:
        runtime = await start_runtime(
            get_runtime_for_user(user),
            extra_env=runtime_env_for_user(str(user["id"])),
            wait_ready=False,
        )

    base = runtime_dashboard_base_url(runtime, ensure_network=False)
    if not base:
        if lightweight:
            _schedule_runtime_ensure(user)
        raise HTTPException(status_code=503, detail="Runtime dashboard is starting. Retry shortly.")

    # Status polls must stay cheap: DB token + short upstream timeout.
    token = await _runtime_dashboard_token_async(runtime.id, runtime, prefer_live=False)
    target = f"{base.rstrip('/')}/{path}"
    body = await request.body()
    timeout = httpx.Timeout(2.0 if lightweight else 300.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                target,
                params=request.query_params,
                content=body,
                headers=_proxy_headers(request, token),
            )
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError, httpx.ReadError, httpx.TimeoutException) as exc:
        if lightweight:
            _schedule_runtime_ensure(user)
        raise HTTPException(
            status_code=503,
            detail="Runtime dashboard is starting. Retry shortly.",
        ) from exc

    if upstream.status_code < 500:
        mark_runtime_healthy(runtime)
    elif lightweight and upstream.status_code >= 500:
        _schedule_runtime_ensure(user)

    if upstream.status_code < 400 and _dashboard_path_needs_inference_env_reassert(path, request.method):
        runtime_env = runtime_env_for_user(str(user["id"]))
        if runtime_env and runtime.status == "running":
            runtime = await restart_runtime(get_runtime_for_user(user, fresh=True), extra_env=runtime_env)
            mark_runtime_healthy(runtime)

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in {"content-encoding", "content-length", "set-cookie", "transfer-encoding"}
    }
    content = upstream.content
    if path.strip("/") == "api/status":
        content = normalize_gateway_status_content(content)
    return Response(content=content, status_code=upstream.status_code, headers=response_headers)


def _ws_target_url(runtime_url: str, path: str, query: str, token: str) -> str:
    parsed = httpx.URL(runtime_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    params = [(key, value) for key, value in parse_qsl(query, keep_blank_values=True) if key != "token"]
    params.append(("token", token))
    return f"{scheme}://{parsed.host}:{parsed.port or 80}/{path}?{urlencode(params)}"


def _runtime_ws_open_timeout_seconds() -> float:
    # Keep this short: a hung docker-proxy/upstream must not stall the API worker.
    raw = os.getenv("VERXIO_RUNTIME_WS_OPEN_TIMEOUT_SECONDS", "8").strip()
    try:
        return max(3.0, float(raw))
    except ValueError:
        return 8.0


async def _safe_websocket_close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except RuntimeError:
        # Starlette rejects a second close after the socket is already gone.
        pass


@app.websocket("/api/runtime/dashboard/ws/{path:path}")
async def proxy_runtime_dashboard_ws(path: str, websocket: WebSocket) -> None:
    user = get_current_user(websocket)  # type: ignore[arg-type]
    if not user:
        await _safe_websocket_close(websocket, 4401)
        return

    # Finish the browser handshake before any runtime work — nginx and the
    # renderer both time out if accept() waits on docker + bridge sync.
    await websocket.accept()

    try:
        runtime = get_runtime_for_user(user)
        base = runtime_dashboard_base_url(runtime, ensure_network=False)
        # Never await docker run on the WS path. Try upstream directly so a
        # stale DB status does not block reconnect while ensure runs in background.
        if not base:
            _schedule_runtime_ensure(user)
            await _safe_websocket_close(websocket, 1013)
            return
        if runtime.status != "running":
            _schedule_runtime_ensure(user)

        async def _sync_bridges_in_background() -> None:
            try:
                # Never restart the container from the WS path — a Docker bounce
                # mid-handshake is what turns a green status into "Reconnecting".
                await _sync_composio_bridge_for_user(user, apply_live=True, allow_restart=False)
                await _sync_inference_bridge_for_user(user, refresh_running=False, allow_restart=False)
            except Exception:
                logger.exception("Background runtime bridge sync failed after websocket connect")

        asyncio.create_task(_sync_bridges_in_background())

        # DB token only — live docker inspect on connect freezes the worker.
        token = await _runtime_dashboard_token_async(runtime.id, runtime, prefer_live=False)
        last_error: Exception | None = None
        upstream = None
        candidates = runtime_dashboard_ws_candidates(runtime) or ([base] if base else [])
        for candidate in candidates:
            target = _ws_target_url(candidate, path, websocket.url.query, token)
            logger.info("Runtime dashboard websocket proxy connecting target=%s", target.split("?", 1)[0])
            try:
                upstream = await asyncio.wait_for(
                    websockets.connect(
                        target,
                        additional_headers={"X-Hermes-Session-Token": token},
                        open_timeout=_runtime_ws_open_timeout_seconds(),
                        close_timeout=2,
                    ),
                    timeout=_runtime_ws_open_timeout_seconds() + 2.0,
                )
                break
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Runtime dashboard websocket upstream failed target=%s error=%s",
                    target.split("?", 1)[0],
                    exc,
                )

        if upstream is None:
            _schedule_runtime_ensure(user)
            raise last_error or RuntimeError("No Hermes websocket upstream available")

        try:
            async def client_to_runtime() -> None:
                while True:
                    message = await websocket.receive()
                    if message.get("type") == "websocket.disconnect":
                        await upstream.close()
                        return
                    if "text" in message:
                        await upstream.send(message["text"])
                    elif "bytes" in message:
                        await upstream.send(message["bytes"])

            async def runtime_to_client() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(str(message))

            await asyncio.gather(client_to_runtime(), runtime_to_client())
        finally:
            await upstream.close()
    except WebSocketDisconnect:
        logger.info("Runtime dashboard websocket client disconnected path=%s", path)
    except Exception:
        logger.exception("Runtime dashboard websocket proxy failed for path=%s", path)
        await _safe_websocket_close(websocket, 1011)


def _find_run(run_id: str) -> RunRecord:
    for run in RUNS:
        if run.id == run_id:
            return run
    raise HTTPException(status_code=404, detail="Run not found")


async def _refresh_run(run: RunRecord) -> RunRecord:
    if (
        run.provider != "hermes"
        or not run.hermes_run_id
        or run.status in {"completed", "failed", "cancelled"}
    ):
        return run

    result = await HermesRuntimeAdapter().get_run_status(run.hermes_run_id)
    run.status = result.status
    run.output = result.output if result.output else result.error or run.output
    run.usage = result.usage
    if result.status in {"completed", "failed", "cancelled"}:
        AUDIT_LOG.insert(
            0,
            AuditEvent(
                agent_id=run.agent_id,
                actor=PROFILE.name,
                action="runtime.run.completed" if result.status == "completed" else "runtime.run.finished",
                summary=result.error or f"Hermes run {run.hermes_run_id} is {result.status}.",
                status="success" if result.status == "completed" else "warning",
                metadata={
                    "provider": result.provider,
                    "run": run.id,
                    "hermes_run": run.hermes_run_id or "",
                },
            ),
        )
    return run


@app.post("/api/runs", response_model=RunRecord)
async def create_run(payload: RunRequest) -> RunRecord:
    if payload.workspace_id != WORKSPACE.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if payload.agent_id != PROFILE.id:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    if PROFILE.status != "active":
        raise HTTPException(status_code=409, detail="Verxio Agent is not active")

    AUDIT_LOG.insert(
        0,
        AuditEvent(
            agent_id=PROFILE.id,
            actor="Verxio",
            action="runtime.run.requested",
            summary="Submitted a Verxio Agent run to the Hermes runtime.",
            status="pending",
            metadata={"workspace": WORKSPACE.id},
        ),
    )

    result = await HermesRuntimeAdapter().submit_agent_run(WORKSPACE, PROFILE, payload.input)
    run = RunRecord(
        workspace_id=WORKSPACE.id,
        agent_id=PROFILE.id,
        input=payload.input,
        output=result.output if result.output else result.error or "",
        provider=result.provider,
        status=result.status,
        hermes_run_id=result.hermes_run_id,
        usage=result.usage,
    )
    RUNS.insert(0, run)

    AUDIT_LOG.insert(
        0,
        AuditEvent(
            agent_id=PROFILE.id,
            actor=PROFILE.name,
            action="runtime.run.completed" if result.status == "completed" else "runtime.run.started",
            summary=result.error or f"Verxio Agent returned a {result.provider} runtime result.",
            status="success" if result.status == "completed" else "pending",
            metadata={
                "provider": result.provider,
                "run": run.id,
                "hermes_run": result.hermes_run_id or "",
            },
        ),
    )

    return run


@app.get("/api/runs/{run_id}", response_model=RunRecord)
async def get_run(run_id: str) -> RunRecord:
    run = _find_run(run_id)
    return await _refresh_run(run)


@app.post("/api/runs/{run_id}/stop", response_model=RunRecord)
async def stop_run(run_id: str) -> RunRecord:
    run = _find_run(run_id)
    run = await _refresh_run(run)
    if run.status in {"completed", "failed", "cancelled"}:
        return run

    if run.provider != "hermes" or not run.hermes_run_id:
        run.status = "cancelled"
        run.output = "Run cancelled."
        return run

    result = await HermesRuntimeAdapter().stop_run(run.hermes_run_id)
    run.status = result.status
    run.output = result.output if result.output else result.error or "Stop requested."
    AUDIT_LOG.insert(
        0,
        AuditEvent(
            agent_id=run.agent_id,
            actor="Verxio",
            action="runtime.run.stop_requested",
            summary=f"Stop requested for Hermes run {run.hermes_run_id}.",
            status="warning",
            metadata={"run": run.id, "hermes_run": run.hermes_run_id},
        ),
    )
    return run


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str) -> FileResponse:
    if full_path.startswith("api/") or full_path.startswith("static/"):
        raise HTTPException(status_code=404, detail="Not found")

    return FileResponse(STATIC_ROOT / "index.html")
