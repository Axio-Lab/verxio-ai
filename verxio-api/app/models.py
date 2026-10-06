from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"

class Workspace(BaseModel):
    id: str
    name: str
    region: str
    plan: str
    tenant_id: str = "local"
    slug: str = "local-verxio"
    kind: str = "personal"

class AgentProfile(BaseModel):
    id: str
    name: str
    role: str
    status: Literal["active", "setup_required", "offline"]
    description: str
    capabilities: list[str]
    starters: list[str]
    workspace_id: str = "local-verxio"
    tenant_id: str = "local"

class AuditEvent(BaseModel):
    id: str = Field(default_factory=lambda: new_id("evt"))
    agent_id: str
    actor: str
    action: str
    summary: str
    status: Literal["success", "warning", "error", "pending"]
    created_at: datetime = Field(default_factory=utc_now)
    metadata: dict[str, str] = Field(default_factory=dict)

class RuntimeStatus(BaseModel):
    mode: Literal["demo", "auto", "hermes"]
    configured: bool
    connected: bool
    base_url: str
    detail: str

class UserPublic(BaseModel):
    id: str
    email: str
    name: str

class SignupInviteResponse(BaseModel):
    invite_code: str

class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    name: str = Field(min_length=1, max_length=120)
    invite_code: str = Field(min_length=1, max_length=64)

class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)

class EmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

class AuthCodeChallengeResponse(BaseModel):
    ok: bool = True
    email: str
    purpose: Literal["email_verify", "login", "password_reset"]
    expiresInSeconds: int

class AuthCodeVerifyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")

class PasswordResetRequest(AuthCodeVerifyRequest):
    password: str = Field(min_length=8, max_length=256)

class AuthResponse(BaseModel):
    user: UserPublic
    workspace: Workspace
    profile: AgentProfile

class RuntimeInstance(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    mode: str
    status: str
    container_id: str | None = None
    container_name: str | None = None
    image: str | None = None
    dashboard_url: str | None = None
    hermes_home_path: str
    workspace_path: str
    artifact_path: str
    last_started_at: str | None = None
    last_seen_at: str | None = None
    last_error: str | None = None
    last_activity_at: str | None = None
    idle_policy: str = "default"
    cell_id: str = "cell_default"
    manager: str | None = None
    external_ref: str | None = None

class RuntimeControlResponse(BaseModel):
    runtime: RuntimeInstance
    connected: bool
    detail: str
    # Spin-up step for the UI: queued | restoring_home | preparing_env |
    # attaching_profile | ready | failed | starting | stopped.
    phase: str | None = None
    phase_detail: str | None = None

class RuntimeWorkspaceSyncRequest(BaseModel):
    workspace_path: str = Field(min_length=1)

InferenceMode = Literal["hosted", "byok"]

class InferenceModelCapability(BaseModel):
    key: str
    label: str

class InferenceModelPricing(BaseModel):
    inputPerMillion: float
    outputPerMillion: float
    currency: str = "USD"

class InferenceModelCatalogItem(BaseModel):
    id: str
    displayName: str
    description: str
    providerSlug: str
    upstreamModelId: str
    availableModelIds: list[str] = Field(default_factory=list)
    requiredEnvVars: list[str]
    hostedAvailable: bool
    byokAvailable: bool
    tier: str
    capabilities: list[InferenceModelCapability] = Field(default_factory=list)
    pricing: InferenceModelPricing
    default: bool = False

class InferenceCatalogResponse(BaseModel):
    models: list[InferenceModelCatalogItem]
    defaultModelId: str

class InferenceSettings(BaseModel):
    mode: InferenceMode = "hosted"
    defaultModelId: str = "verxio-qwen"
    monthlyCreditUsd: float = 0
    overageEnabled: bool = False
    spendingLimitUsd: float | None = None

class InferenceSettingsUpdate(BaseModel):
    mode: InferenceMode | None = None
    defaultModelId: str | None = Field(default=None, min_length=1, max_length=80)
    overageEnabled: bool | None = None
    spendingLimitUsd: float | None = Field(default=None, ge=0)

class InferenceUsageSummary(BaseModel):
    periodStart: str | None = None
    periodEnd: str | None = None
    monthlyCreditUsd: float = 0
    usedUsd: float = 0
    remainingUsd: float = 0
    events: int = 0

class InferenceUsageResponse(BaseModel):
    settings: InferenceSettings
    usage: InferenceUsageSummary

class DeviceTokenCreateRequest(BaseModel):
    name: str = Field(default="", max_length=120)
    platform: str = Field(default="", max_length=64)

class DeviceToken(BaseModel):
    id: str
    name: str = ""
    platform: str = ""
    createdAt: str
    lastUsedAt: str | None = None
    revokedAt: str | None = None

class DeviceTokenCreateResponse(BaseModel):
    token: str
    device: DeviceToken

class DeviceTokenListResponse(BaseModel):
    devices: list[DeviceToken]

class GatewayModel(BaseModel):
    id: str
    object: Literal["model"] = "model"
    owned_by: str = "verxio"
    verxioModelId: str
    providerSlug: str
    hostedAvailable: bool

class GatewayModelList(BaseModel):
    object: Literal["list"] = "list"
    data: list[GatewayModel]

class ComposioMcpSessionResponse(BaseModel):
    configured: bool
    enabled: bool
    serverName: str = "composio"
    connectedApps: list[str] = Field(default_factory=list)
    mcpUrl: str | None = None
    mcpApiKey: str | None = None
    prompt: str = ""
    agentPrompt: str = ""
    soulPrompt: str = ""
    publicWebUrl: str | None = None
    message: str | None = None

class AgentStateEntry(BaseModel):
    path: str
    etag: str
    sizeBytes: int
    updatedBy: str
    updatedAt: str
    expiresAt: str | None = None

class AgentStateManifest(BaseModel):
    entries: list[AgentStateEntry]
    usedBytes: int
    quotaBytes: int

TranscriptionProviderId = Literal["elevenlabs", "fishaudio", "groq", "mistral", "openai", "xai"]
TranscriptionCatalogSource = Literal["fallback", "provider"]

class TranscriptionModelOption(BaseModel):
    id: str
    source: TranscriptionCatalogSource = "provider"

class TranscriptionProviderCatalogItem(BaseModel):
    id: TranscriptionProviderId
    label: str
    envKey: str
    docsUrl: str
    description: str
    configured: bool = False
    recommendedModel: str
    models: list[TranscriptionModelOption]
    source: TranscriptionCatalogSource = "fallback"
    error: str | None = None
    fetchedAt: str | None = None

class TranscriptionCatalogResponse(BaseModel):
    providers: list[TranscriptionProviderCatalogItem]
    cacheTtlSeconds: int

class InferenceRuntimeBridgeStatus(BaseModel):
    configured: bool
    enabled: bool
    changed: bool = False
    mode: InferenceMode = "hosted"
    defaultModelId: str = "verxio-qwen"
    providerSlug: str = "alibaba"
    upstreamModelId: str = ""
    missingEnvVars: list[str] = Field(default_factory=list)
    message: str | None = None

class ArtifactRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    file_name: str
    relative_path: str
    content_type: str
    size_bytes: int
    source: str
    created_at: str
    updated_at: str

class ArtifactListResponse(BaseModel):
    artifacts: list[ArtifactRecord]

class NotepadRecordingUploadRequest(BaseModel):
    file_name: str = Field(default="notepad-recording.webm", min_length=1, max_length=180)
    data_url: str = Field(min_length=1)
    mime_type: str | None = Field(default=None, max_length=120)

class NotepadRecordingUploadResponse(BaseModel):
    artifact: ArtifactRecord

class NotepadFolderRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    name: str
    sort_order: int = 0
    created_at: str
    updated_at: str

class NotepadNoteRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    folder_id: str | None = None
    title: str
    content: str = ""
    transcript: str = ""
    summary: str = ""
    meeting_type: str = "general"
    source: str = "manual"
    share_token: str | None = None
    created_at: str
    updated_at: str

class NotepadListResponse(BaseModel):
    folders: list[NotepadFolderRecord]
    notes: list[NotepadNoteRecord]

class NotepadFolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)

class NotepadFolderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = Field(default=None, ge=0)

class NotepadNoteCreateRequest(BaseModel):
    title: str = Field(default="Untitled note", min_length=1, max_length=180)
    folder_id: str | None = None
    content: str = ""
    transcript: str = ""
    summary: str = ""
    meeting_type: str = Field(default="general", max_length=80)
    source: str = Field(default="manual", max_length=80)

class NotepadNoteUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    folder_id: str | None = None
    content: str | None = None
    transcript: str | None = None
    summary: str | None = None
    meeting_type: str | None = Field(default=None, max_length=80)
    source: str | None = Field(default=None, max_length=80)

class NotepadShareResponse(BaseModel):
    token: str
    url: str
    note: NotepadNoteRecord

class PublicNotepadShareResponse(BaseModel):
    note: NotepadNoteRecord
    folder: NotepadFolderRecord | None = None
    workspace_name: str

class ComposioConnectedAccount(BaseModel):
    id: str
    appSlug: str
    status: str
    createdAt: str | None = None

class ComposioToolPreview(BaseModel):
    slug: str
    name: str
    description: str = ""
    inputParameters: dict[str, Any] = Field(default_factory=dict)

class ComposioToolBridgeStatus(BaseModel):
    configured: bool
    enabled: bool
    changed: bool = False
    serverName: str = "composio"
    connectedApps: list[str] = Field(default_factory=list)
    message: str | None = None

class ComposioApp(BaseModel):
    slug: str
    name: str
    description: str
    logoUrl: str | None = None
    categories: list[str] = Field(default_factory=list)
    noAuth: bool = False
    authMode: Literal["no_auth", "managed_oauth", "connect_link", "requires_oauth_app"] = "managed_oauth"
    authSchemes: list[str] = Field(default_factory=list)
    connectable: bool = True
    toolsCount: int | None = None
    triggersCount: int | None = None
    sampleTools: list[ComposioToolPreview] = Field(default_factory=list)

class ComposioConnectionsResponse(BaseModel):
    accounts: list[ComposioConnectedAccount]
    configured: bool
    toolBridge: ComposioToolBridgeStatus | None = None

class ComposioAppsResponse(BaseModel):
    apps: list[ComposioApp]
    configured: bool
    catalogReady: bool = False
    catalogError: str | None = None

class ComposioAppToolsResponse(BaseModel):
    tools: list[ComposioToolPreview]
    configured: bool
    catalogReady: bool = False
    catalogError: str | None = None

class ComposioTriggerType(BaseModel):
    slug: str
    name: str
    description: str = ""
    instructions: str = ""
    type: Literal["poll", "webhook"]
    config: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)
    requiresWebhookEndpointSetup: bool = False

class ComposioTriggerTypesResponse(BaseModel):
    triggers: list[ComposioTriggerType]
    configured: bool

class ComposioAuthInputField(BaseModel):
    name: str
    displayName: str
    type: str = "string"
    description: str = ""
    required: bool = True
    isSecret: bool = False

class ComposioConnectionSetupResponse(BaseModel):
    appSlug: str
    name: str
    authMode: Literal["no_auth", "managed_oauth", "connect_link", "requires_oauth_app"]
    authScheme: str | None = None
    supportsInline: bool = False
    supportsLink: bool = True
    inputFields: list[ComposioAuthInputField] = Field(default_factory=list)

class ComposioInitiateRequest(BaseModel):
    appSlug: str = Field(min_length=1, max_length=120)
    callbackUrl: str | None = None

class ComposioInitiateResponse(BaseModel):
    redirectUrl: str | None = None
    connectionId: str

class ComposioCompleteConnectionRequest(BaseModel):
    appSlug: str = Field(min_length=1, max_length=120)
    credentials: dict[str, str] = Field(default_factory=dict)

class ComposioCompleteConnectionResponse(BaseModel):
    connectionId: str
    status: str

class HermesRuntimeMetadata(BaseModel):
    capabilities: dict = Field(default_factory=dict)
    health: dict[str, Any] = Field(default_factory=dict)
    models: list[dict] = Field(default_factory=list)
    jobs: list[dict] = Field(default_factory=list)
    skills: list[dict] = Field(default_factory=list)
    toolsets: list[dict] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

class RunRequest(BaseModel):
    agent_id: str = "verxio-agent"
    input: str = Field(min_length=1, max_length=8000)
    workspace_id: str = "local-verxio"

class RuntimeResult(BaseModel):
    provider: Literal["demo", "hermes"]
    status: Literal["queued", "running", "completed", "failed", "waiting_for_approval", "cancelled"]
    output: str
    hermes_run_id: str | None = None
    usage: dict[str, int] = Field(default_factory=dict)
    error: str | None = None

class RunRecord(BaseModel):
    id: str = Field(default_factory=lambda: new_id("run"))
    workspace_id: str
    agent_id: str
    input: str
    output: str
    provider: Literal["demo", "hermes"]
    status: Literal["queued", "running", "completed", "failed", "waiting_for_approval", "cancelled"]
    hermes_run_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    usage: dict[str, int] = Field(default_factory=dict)

class BootstrapResponse(BaseModel):
    workspace: Workspace
    profile: AgentProfile
    audit_log: list[AuditEvent]
    runs: list[RunRecord]
    runtime: RuntimeStatus
    hermes: HermesRuntimeMetadata
