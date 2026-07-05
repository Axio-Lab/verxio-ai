from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

import httpx
import websockets
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

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
    InferenceCatalogResponse,
    InferenceSettings,
    InferenceSettingsUpdate,
    InferenceUsageResponse,
    LoginRequest,
    NotepadFolderCreateRequest,
    NotepadFolderRecord,
    NotepadFolderUpdateRequest,
    NotepadListResponse,
    NotepadNoteCreateRequest,
    NotepadNoteRecord,
    NotepadNoteUpdateRequest,
    NotepadShareResponse,
    PasswordResetRequest,
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
from app.runtime import HermesRuntimeAdapter
from app.runtime_manager import (
    artifact_file,
    index_artifacts,
    restart_runtime,
    runtime_container_env_matches,
    runtime_health,
    start_runtime,
    stop_runtime,
    sync_runtime_workspace,
)
from app.store import AUDIT_LOG, PROFILE, RUNS, WORKSPACE


APP_ROOT = Path(__file__).resolve().parent.parent
STATIC_ROOT = APP_ROOT / "static"

app = FastAPI(
    title="Verxio API",
    version="0.1.0",
    description="Verxio control plane for isolated Hermes Agent runtimes.",
)

cors_origins = [
    origin.strip()
    for origin in os.getenv("VERXIO_CORS_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_ROOT), name="static")


@app.on_event("startup")
async def startup() -> None:
    db.run_migrations()


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

    adapter = HermesRuntimeAdapter()
    runtime = await adapter.status()
    hermes = await adapter.metadata() if runtime.configured else None
    return BootstrapResponse(
        workspace=workspace,
        profile=profile,
        audit_log=sorted(AUDIT_LOG, key=lambda event: event.created_at, reverse=True),
        runs=sorted(RUNS, key=lambda run: run.created_at, reverse=True),
        runtime=runtime,
        hermes=hermes or await HermesRuntimeAdapter().metadata(),
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


@app.get("/api/runtime", response_model=RuntimeControlResponse)
async def get_runtime(request: Request) -> RuntimeControlResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    connected, detail = await runtime_health(runtime)
    return RuntimeControlResponse(runtime=runtime, connected=connected, detail=detail)


@app.post("/api/runtime/start", response_model=RuntimeControlResponse)
async def start_runtime_route(request: Request) -> RuntimeControlResponse:
    user = require_user(request)
    _accounts, _bridge = await _sync_composio_bridge_for_user(user, refresh_running=True)
    _inference_bridge = await _sync_inference_bridge_for_user(user, refresh_running=True)
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
    await _sync_composio_bridge_for_user(user, refresh_running=True)
    await _sync_inference_bridge_for_user(user, refresh_running=True)
    runtime = await restart_runtime(get_runtime_for_user(user), extra_env=runtime_env_for_user(str(user["id"])))
    connected, detail = await runtime_health(runtime)
    return RuntimeControlResponse(runtime=runtime, connected=connected, detail=detail)


@app.post("/api/runtime/workspace", response_model=RuntimeControlResponse)
async def sync_runtime_workspace_route(
    request: Request, body: RuntimeWorkspaceSyncRequest
) -> RuntimeControlResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
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


@app.get("/api/artifacts", response_model=ArtifactListResponse)
async def list_artifacts(request: Request) -> ArtifactListResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    return ArtifactListResponse(artifacts=index_artifacts(runtime))


@app.get("/api/artifacts/{artifact_id}")
async def get_artifact(artifact_id: str, request: Request):
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    try:
        record, _path = artifact_file(runtime, artifact_id)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    return record


@app.get("/api/artifacts/{artifact_id}/preview")
async def preview_artifact(artifact_id: str, request: Request) -> FileResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    try:
        record, path = artifact_file(runtime, artifact_id)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    return FileResponse(path, media_type=record.content_type, filename=record.file_name)


@app.get("/api/artifacts/{artifact_id}/download")
async def download_artifact(artifact_id: str, request: Request) -> FileResponse:
    user = require_user(request)
    runtime = get_runtime_for_user(user)
    try:
        record, path = artifact_file(runtime, artifact_id)
    except (FileNotFoundError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    return FileResponse(path, media_type=record.content_type, filename=record.file_name)


def _share_url(_request: Request, token: str) -> str:
    public_base = os.getenv("VERXIO_PUBLIC_WEB_URL", "").strip().rstrip("/")
    if not public_base:
        public_base = "http://127.0.0.1:8080"
    return f"{public_base}/share/notepad/{token}"


@app.get("/api/notepad", response_model=NotepadListResponse)
async def list_notepad_route(request: Request) -> NotepadListResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return list_notepad(workspace, profile)


@app.post("/api/notepad/folders", response_model=NotepadFolderRecord)
async def create_notepad_folder_route(
    payload: NotepadFolderCreateRequest,
    request: Request,
) -> NotepadFolderRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return create_folder(workspace, profile, payload)


@app.patch("/api/notepad/folders/{folder_id}", response_model=NotepadFolderRecord)
async def update_notepad_folder_route(
    folder_id: str,
    payload: NotepadFolderUpdateRequest,
    request: Request,
) -> NotepadFolderRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return update_folder(workspace, profile, folder_id, payload)


@app.delete("/api/notepad/folders/{folder_id}")
async def delete_notepad_folder_route(folder_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return delete_folder(workspace, profile, folder_id)


@app.post("/api/notepad/notes", response_model=NotepadNoteRecord)
async def create_notepad_note_route(
    payload: NotepadNoteCreateRequest,
    request: Request,
) -> NotepadNoteRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return create_note(workspace, profile, payload)


@app.patch("/api/notepad/notes/{note_id}", response_model=NotepadNoteRecord)
async def update_notepad_note_route(
    note_id: str,
    payload: NotepadNoteUpdateRequest,
    request: Request,
) -> NotepadNoteRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return update_note(workspace, profile, note_id, payload)


@app.delete("/api/notepad/notes/{note_id}")
async def delete_notepad_note_route(note_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return delete_note(workspace, profile, note_id)


@app.post("/api/notepad/notes/{note_id}/summarize", response_model=NotepadNoteRecord)
async def summarize_notepad_note_route(note_id: str, request: Request) -> NotepadNoteRecord:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return await summarize_note(workspace, profile, note_id)


@app.post("/api/notepad/notes/{note_id}/share", response_model=NotepadShareResponse)
async def create_notepad_share_route(note_id: str, request: Request) -> NotepadShareResponse:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
    return create_share(workspace, profile, note_id, lambda token: _share_url(request, token))


@app.delete("/api/notepad/notes/{note_id}/share")
async def revoke_notepad_share_route(note_id: str, request: Request) -> dict[str, bool]:
    user = require_user(request)
    workspace, profile, _runtime_instance = get_context_for_user(user)
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


async def _sync_composio_bridge_for_user(user: dict, *, refresh_running: bool = False):
    runtime = get_runtime_for_user(user)
    accounts = list_composio_accounts(str(user["id"]))
    bridge = sync_composio_runtime_bridge(runtime, str(user["id"]), accounts)

    composio_api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
    runtime_env_changed = (
        bridge.enabled
        and bool(composio_api_key)
        and runtime.status == "running"
        and not runtime_container_env_matches(runtime, "COMPOSIO_API_KEY", composio_api_key)
    )

    if runtime.status == "running" and (
        runtime_env_changed or (refresh_running and bridge.changed)
    ):
        await restart_runtime(runtime)

    return accounts, bridge


async def _sync_inference_bridge_for_user(user: dict, *, refresh_running: bool = False):
    runtime = get_runtime_for_user(user)
    bridge = sync_inference_runtime_bridge(runtime, str(user["id"]))
    runtime_env = runtime_env_for_user(str(user["id"]))
    runtime_env_changed = (
        bridge.enabled
        and runtime.status == "running"
        and any(not runtime_container_env_matches(runtime, key, value) for key, value in runtime_env.items())
    )

    if runtime.status == "running" and (runtime_env_changed or (refresh_running and bridge.changed)):
        await restart_runtime(runtime, extra_env=runtime_env)

    return bridge


@app.get("/api/composio/connections", response_model=ComposioConnectionsResponse)
async def list_composio_connections_route(request: Request) -> ComposioConnectionsResponse:
    user = require_user(request)
    accounts, bridge = await _sync_composio_bridge_for_user(user, refresh_running=True)
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
    await _sync_composio_bridge_for_user(user, refresh_running=True)
    return result


@app.delete("/api/composio/connections/{account_id}")
async def delete_composio_connection_route(account_id: str, request: Request) -> dict[str, str]:
    user = require_user(request)
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required.")
    if not is_composio_configured():
        raise HTTPException(status_code=500, detail="Composio is not configured.")
    result = delete_composio_account(account_id)
    await _sync_composio_bridge_for_user(user, refresh_running=True)
    return result


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


def _runtime_dashboard_token(runtime_id: str) -> str:
    row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime_id,))
    token = str(row.get("dashboard_token") or "") if row else ""
    if not token:
        raise HTTPException(status_code=503, detail="Runtime dashboard token is not ready.")
    return token


def _proxy_headers(request: Request, token: str) -> dict[str, str]:
    blocked = {"host", "cookie", "authorization", "x-hermes-session-token"}
    headers = {key: value for key, value in request.headers.items() if key.lower() not in blocked}
    headers["X-Hermes-Session-Token"] = token
    headers["Authorization"] = f"Bearer {token}"
    return headers


@app.api_route(
    "/api/runtime/dashboard/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def proxy_runtime_dashboard(path: str, request: Request) -> Response:
    user = require_user(request)
    await _sync_composio_bridge_for_user(user)
    await _sync_inference_bridge_for_user(user)
    runtime = await start_runtime(get_runtime_for_user(user), extra_env=runtime_env_for_user(str(user["id"])))
    if not runtime.dashboard_url:
        raise HTTPException(status_code=503, detail="Runtime dashboard is not ready.")

    token = _runtime_dashboard_token(runtime.id)
    target = f"{runtime.dashboard_url.rstrip('/')}/{path}"
    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=300, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                target,
                params=request.query_params,
                content=body,
                headers=_proxy_headers(request, token),
            )
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError, httpx.ReadError) as exc:
        # The runtime container is still booting (or restarting): the dashboard
        # socket isn't accepting yet. Return 503 so the web client keeps polling
        # readiness cleanly instead of surfacing a 500 stack trace.
        raise HTTPException(
            status_code=503,
            detail="Runtime dashboard is starting. Retry shortly.",
        ) from exc

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in {"content-encoding", "set-cookie", "transfer-encoding"}
    }
    return Response(content=upstream.content, status_code=upstream.status_code, headers=response_headers)


def _ws_target_url(runtime_url: str, path: str, query: str, token: str) -> str:
    parsed = httpx.URL(runtime_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    params = [(key, value) for key, value in parse_qsl(query, keep_blank_values=True) if key != "token"]
    params.append(("token", token))
    return f"{scheme}://{parsed.host}:{parsed.port or 80}/{path}?{urlencode(params)}"


logger = logging.getLogger(__name__)


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

    # Finish the browser handshake before docker/runtime prep — nginx and the
    # renderer both time out if accept() waits on start_runtime + bridge sync.
    await websocket.accept()

    try:
        await _sync_composio_bridge_for_user(user)
        await _sync_inference_bridge_for_user(user)
        runtime = await start_runtime(
            get_runtime_for_user(user),
            extra_env=runtime_env_for_user(str(user["id"])),
        )
        if not runtime.dashboard_url:
            await _safe_websocket_close(websocket, 1011)
            return

        token = _runtime_dashboard_token(runtime.id)
        target = _ws_target_url(runtime.dashboard_url, path, websocket.url.query, token)

        async with websockets.connect(
            target,
            additional_headers={"X-Hermes-Session-Token": token},
            open_timeout=15,
        ) as upstream:
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

            import asyncio

            await asyncio.gather(client_to_runtime(), runtime_to_client())
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
