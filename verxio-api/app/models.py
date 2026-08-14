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

class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    name: str = Field(min_length=1, max_length=120)

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

WorkflowTriggerType = Literal["manual", "webhook", "schedule", "api", "app_event", "chat"]
WorkflowRunStatus = Literal["queued", "running", "completed", "failed"]
WorkflowDeliveryType = Literal[
    "approval_first",
    "composio_action",
    "reply_to_source",
    "save_only",
    "send_message",
    "webhook_callback",
]

class WorkflowAgentRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    runtime_agent_id: str
    name: str
    role: str = ""
    description: str = ""
    instructions: str = ""
    model_id: str = ""
    enabled: bool = True
    skills: list[str] = Field(default_factory=list)
    knowledge: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    integrations: list[str] = Field(default_factory=list)
    approval_policy: str = "default"
    tags: list[str] = Field(default_factory=list)
    origin: str = "user"
    funnel_rules: dict[str, Any] = Field(default_factory=dict)
    fallback_email: str = ""
    campaign_context: str = ""
    created_at: str
    updated_at: str

class WorkflowAgentCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    role: str = Field(default="", max_length=240)
    description: str = Field(default="", max_length=1000)
    instructions: str = Field(default="", max_length=12000)
    model_id: str = Field(default="", max_length=180)
    enabled: bool = True
    skills: list[str] = Field(default_factory=list)
    knowledge: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    integrations: list[str] = Field(default_factory=list)
    approval_policy: str = Field(default="default", max_length=80)
    fallback_email: str = Field(default="", max_length=320)
    campaign_context: str = Field(default="", max_length=8000)
    funnel_rules: dict[str, Any] = Field(default_factory=dict)

class WorkflowAgentUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    role: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=1000)
    instructions: str | None = Field(default=None, max_length=12000)
    model_id: str | None = Field(default=None, max_length=180)
    enabled: bool | None = None
    skills: list[str] | None = None
    knowledge: list[str] | None = None
    tools: list[str] | None = None
    integrations: list[str] | None = None
    approval_policy: str | None = Field(default=None, max_length=80)
    fallback_email: str | None = Field(default=None, max_length=320)
    campaign_context: str | None = Field(default=None, max_length=8000)
    funnel_rules: dict[str, Any] | None = None

WorkflowSetupActor = Literal["web", "session", "gateway"]
WorkflowSetupApprovalStatus = Literal["pending", "approved", "rejected"]
WorkflowSetupApprovalRisk = Literal[
    "broad_messaging_trigger",
    "destructive_change",
    "external_delivery",
    "paid_or_key_backed_tool",
    "public_link",
    "webhook_callback",
]

class WorkflowSetupTriggerDraft(BaseModel):
    trigger_type: WorkflowTriggerType
    event_name: str = ""
    name: str = ""
    enabled: bool = False
    config: dict[str, Any] = Field(default_factory=dict)
    requires_approval: bool = False

class WorkflowSetupDeliveryDraft(BaseModel):
    delivery_type: str = Field(default="save_only", max_length=80)
    channel: str = Field(default="", max_length=120)
    destination: str = Field(default="", max_length=500)
    template: str = Field(default="", max_length=4000)
    enabled: bool = False
    require_approval: bool = True
    config: dict[str, Any] = Field(default_factory=dict)

class WorkflowAgentSetupDraftData(BaseModel):
    agent: WorkflowAgentCreateRequest
    triggers: list[WorkflowSetupTriggerDraft] = Field(default_factory=list)
    deliveries: list[WorkflowSetupDeliveryDraft] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)

class WorkflowAgentSetupDraftRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=12000)
    source: WorkflowSetupActor = "web"

class WorkflowAgentSetupDraftUpdateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=12000)
    source: WorkflowSetupActor = "web"

class WorkflowAgentSetupDraftRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    runtime_agent_id: str
    workflow_agent_id: str | None = None
    source: WorkflowSetupActor
    prompt: str
    status: str = "draft"
    draft: WorkflowAgentSetupDraftData
    approvals_required: list[WorkflowSetupApprovalRisk] = Field(default_factory=list)
    created_at: str
    updated_at: str

class WorkflowAgentSetupApprovalRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    runtime_agent_id: str
    workflow_agent_id: str | None = None
    setup_draft_id: str | None = None
    risk_type: WorkflowSetupApprovalRisk
    action: str
    status: WorkflowSetupApprovalStatus = "pending"
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str

class WorkflowAgentSetupDraftResponse(BaseModel):
    draft: WorkflowAgentSetupDraftRecord
    approvals: list[WorkflowAgentSetupApprovalRecord] = Field(default_factory=list)

class WorkflowAgentsResponse(BaseModel):
    agents: list[WorkflowAgentRecord]
    setup_drafts: list[WorkflowAgentSetupDraftRecord] = Field(default_factory=list)

class WorkflowAgentSetupApprovalRequest(BaseModel):
    status: WorkflowSetupApprovalStatus
    approval_ids: list[str] = Field(default_factory=list)

class WorkflowAgentSetupApprovalResponse(BaseModel):
    approvals: list[WorkflowAgentSetupApprovalRecord]

class WorkflowAgentSetupApplyRequest(BaseModel):
    setup_draft_id: str = Field(min_length=1, max_length=180)
    enable_created_records: bool = False

class WorkflowAgentSetupApplyResponse(BaseModel):
    agent: WorkflowAgentRecord
    approvals: list[WorkflowAgentSetupApprovalRecord] = Field(default_factory=list)
    deliveries: list[WorkflowDeliveryRecord] = Field(default_factory=list)
    triggers: list[WorkflowTriggerRecord] = Field(default_factory=list)

class WorkflowSkillCapability(BaseModel):
    name: str
    description: str = ""
    category: str = ""
    enabled: bool = True

class WorkflowSkillCapabilitiesResponse(BaseModel):
    skills: list[WorkflowSkillCapability]
    errors: list[str] = Field(default_factory=list)

class WorkflowToolCapability(BaseModel):
    name: str
    display_name: str = ""
    description: str = ""
    category: str = ""
    source: str = "hermes"
    tools: list[str] = Field(default_factory=list)
    enabled: bool = True
    id: str | None = None
    auth_type: str = ""
    api_key_env: str = ""
    configured: bool = True
    method: str = ""
    url: str = ""

class WorkflowToolCapabilitiesResponse(BaseModel):
    tools: list[WorkflowToolCapability]
    errors: list[str] = Field(default_factory=list)

class WorkflowCustomToolCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    method: str = Field(default="POST", max_length=12)
    url: str = Field(min_length=1, max_length=2000)
    auth_type: str = Field(default="api_key", max_length=40)
    api_key_env: str = Field(default="", max_length=120)
    headers: dict[str, str] = Field(default_factory=dict)
    request_schema: dict[str, Any] = Field(default_factory=dict)
    response_hint: str = Field(default="", max_length=2000)
    enabled: bool = True

class WorkflowCustomToolUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    method: str | None = Field(default=None, max_length=12)
    url: str | None = Field(default=None, min_length=1, max_length=2000)
    auth_type: str | None = Field(default=None, max_length=40)
    api_key_env: str | None = Field(default=None, max_length=120)
    headers: dict[str, str] | None = None
    request_schema: dict[str, Any] | None = None
    response_hint: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None

class WorkflowCustomToolRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    name: str
    description: str = ""
    method: str = "POST"
    url: str
    auth_type: str = "api_key"
    api_key_env: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    request_schema: dict[str, Any] = Field(default_factory=dict)
    response_hint: str = ""
    enabled: bool = True
    created_at: str
    updated_at: str

class WorkflowCustomToolsResponse(BaseModel):
    tools: list[WorkflowCustomToolRecord]

class WorkflowIntegrationCapability(BaseModel):
    slug: str
    name: str
    description: str = ""
    categories: list[str] = Field(default_factory=list)
    connected: bool = False
    authMode: str | None = None

class WorkflowIntegrationCapabilitiesResponse(BaseModel):
    integrations: list[WorkflowIntegrationCapability]
    configured: bool
    errors: list[str] = Field(default_factory=list)

class KnowledgeBaseRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    name: str
    description: str = ""
    document_count: int = 0
    created_at: str
    updated_at: str

class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=1000)

class KnowledgeBasesResponse(BaseModel):
    knowledge_bases: list[KnowledgeBaseRecord]

class KnowledgeDocumentRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    knowledge_base_id: str
    title: str
    source: str = "manual"
    content: str
    created_at: str
    updated_at: str

class KnowledgeDocumentCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=220)
    source: str = Field(default="manual", max_length=120)
    content: str = Field(min_length=1, max_length=200000)

class KnowledgeDocumentsResponse(BaseModel):
    documents: list[KnowledgeDocumentRecord]

class WorkflowTriggerRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    workflow_agent_id: str
    trigger_type: WorkflowTriggerType
    event_name: str = ""
    name: str = ""
    enabled: bool = True
    secret: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    webhook_url: str | None = None
    created_at: str
    updated_at: str

class WorkflowTriggerCreateRequest(BaseModel):
    trigger_type: WorkflowTriggerType
    event_name: str = Field(default="", max_length=180)
    name: str = Field(default="", max_length=180)
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)

class WorkflowTriggerUpdateRequest(BaseModel):
    event_name: str | None = Field(default=None, max_length=180)
    name: str | None = Field(default=None, max_length=180)
    enabled: bool | None = None
    config: dict[str, Any] | None = None
    rotate_secret: bool = False

class WorkflowTriggersResponse(BaseModel):
    triggers: list[WorkflowTriggerRecord]

class WorkflowDeliveryRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    workflow_agent_id: str
    delivery_type: WorkflowDeliveryType
    name: str = ""
    channel: str = ""
    destination: str = ""
    template: str = ""
    enabled: bool = True
    require_approval: bool = False
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str

class WorkflowDeliveryCreateRequest(BaseModel):
    delivery_type: WorkflowDeliveryType
    name: str = Field(default="", max_length=180)
    channel: str = Field(default="", max_length=120)
    destination: str = Field(default="", max_length=320)
    template: str = Field(default="", max_length=4000)
    enabled: bool = True
    require_approval: bool = False
    config: dict[str, Any] = Field(default_factory=dict)

class WorkflowDeliveryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=180)
    channel: str | None = Field(default=None, max_length=120)
    destination: str | None = Field(default=None, max_length=320)
    template: str | None = Field(default=None, max_length=4000)
    enabled: bool | None = None
    require_approval: bool | None = None
    config: dict[str, Any] | None = None

class WorkflowDeliveriesResponse(BaseModel):
    deliveries: list[WorkflowDeliveryRecord]

class WorkflowAgentEmbedConfigRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    runtime_agent_id: str
    workflow_agent_id: str
    public_token: str
    enabled: bool = False
    display_name: str = ""
    welcome_message: str = ""
    primary_color: str = "#0ea5e9"
    logo_url: str = ""
    asset_url: str = ""
    allowed_origins: list[str] = Field(default_factory=list)
    share_url: str = ""
    embed_script: str = ""
    created_at: str
    updated_at: str

class WorkflowAgentEmbedConfigUpdateRequest(BaseModel):
    enabled: bool | None = None
    display_name: str | None = Field(default=None, max_length=180)
    welcome_message: str | None = Field(default=None, max_length=1000)
    primary_color: str | None = Field(default=None, max_length=32)
    logo_url: str | None = Field(default=None, max_length=1000)
    asset_url: str | None = Field(default=None, max_length=1000)
    allowed_origins: list[str] | None = None

class WorkflowAgentEmbedAssetRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=220)
    data_url: str = Field(min_length=1, max_length=4000000)

class WorkflowAgentPublicInfo(BaseModel):
    public_token: str
    name: str
    description: str = ""
    display_name: str = ""
    welcome_message: str = ""
    primary_color: str = "#0ea5e9"
    logo_url: str = ""
    asset_url: str = ""
    powered_by: str = "Verxio"

class WorkflowAgentPublicRunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=50000)
    input: dict[str, Any] = Field(default_factory=dict)
    visitor_id: str = Field(default="", max_length=320)
    page_url: str = Field(default="", max_length=1000)

class WorkflowAgentPublicRunResponse(BaseModel):
    run: WorkflowRunRecord

class WorkflowRunRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    runtime_agent_id: str
    workflow_agent_id: str
    trigger_id: str | None = None
    trigger_type: WorkflowTriggerType
    status: WorkflowRunStatus
    input: dict[str, Any] = Field(default_factory=dict)
    output_text: str = ""
    error: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str
    updated_at: str

class WorkflowRunEventRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    workflow_agent_id: str
    workflow_run_id: str
    event_type: str
    message: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str

class WorkflowRunCreateRequest(BaseModel):
    input: dict[str, Any] = Field(default_factory=dict)

class WorkflowTriggerRunRequest(BaseModel):
    event_name: str = Field(default="", max_length=180)
    input: dict[str, Any] = Field(default_factory=dict)

WorkflowMessagingChannel = Literal["whatsapp", "telegram", "slack", "discord", "email", "webchat", "other"]

class WorkflowMessagingTriggerRequest(BaseModel):
    channel: WorkflowMessagingChannel
    connection_id: str = Field(default="default", max_length=180)
    message: str = Field(default="", max_length=50000)
    event_name: str = Field(default="message.received", max_length=180)
    sender_id: str = Field(default="", max_length=320)
    sender_name: str = Field(default="", max_length=320)
    thread_id: str = Field(default="", max_length=320)
    conversation_id: str = Field(default="", max_length=320)
    message_id: str = Field(default="", max_length=320)
    input: dict[str, Any] = Field(default_factory=dict)

class WorkflowRunsResponse(BaseModel):
    runs: list[WorkflowRunRecord]

class WorkflowTriggerRunsResponse(BaseModel):
    runs: list[WorkflowRunRecord]

class WorkflowRunEventsResponse(BaseModel):
    events: list[WorkflowRunEventRecord]

class WorkflowWebhookIngestResponse(BaseModel):
    run: WorkflowRunRecord

class SdrContactRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    workflow_agent_id: str
    channel: str = ""
    sender_id: str = ""
    sender_name: str = ""
    conversation_id: str = ""
    connection_id: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str

class SdrContactsResponse(BaseModel):
    contacts: list[SdrContactRecord]
    total: int = 0

class SdrContactsExportResponse(BaseModel):
    filename: str
    vcf: str

class BootstrapResponse(BaseModel):
    workspace: Workspace
    profile: AgentProfile
    audit_log: list[AuditEvent]
    runs: list[RunRecord]
    runtime: RuntimeStatus
    hermes: HermesRuntimeMetadata
