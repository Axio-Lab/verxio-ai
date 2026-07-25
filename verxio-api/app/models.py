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


TranscriptionProviderId = Literal["elevenlabs", "groq", "mistral", "openai", "xai"]
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


PulseChannelType = Literal["instagram", "messenger", "whatsapp", "tiktok", "linkedin"]
PulseChannelStatus = Literal["draft", "connected", "needs_review", "limited", "disabled", "error"]
PulseConversationState = Literal["automated", "human", "paused"]
PulseMessageDirection = Literal["inbound", "outbound", "system"]
PulseRunStatus = Literal["queued", "running", "waiting", "completed", "failed", "handoff"]


class PulseChannelCapability(BaseModel):
    key: str
    label: str
    supported: bool
    description: str = ""
    gated: bool = False


class PulseChannelRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    channel_type: PulseChannelType
    external_id: str
    display_name: str
    status: PulseChannelStatus = "draft"
    capabilities: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class PulseChannelCreateRequest(BaseModel):
    channel_type: PulseChannelType
    external_id: str = Field(min_length=1, max_length=240)
    display_name: str = Field(min_length=1, max_length=180)
    credentials: dict[str, str] = Field(default_factory=dict)


class PulseChannelConnectRequest(BaseModel):
    channel_type: PulseChannelType
    callbackUrl: str | None = None
    external_id: str | None = Field(default=None, max_length=240)
    display_name: str | None = Field(default=None, max_length=180)
    credentials: dict[str, str] = Field(default_factory=dict)


class PulseChannelConnectResponse(BaseModel):
    channel: PulseChannelRecord | None = None
    redirectUrl: str | None = None
    message: str


class PulseMetaOAuthCompleteRequest(BaseModel):
    code: str = Field(min_length=1, max_length=2000)
    redirectUri: str = Field(min_length=1, max_length=2000)
    channel_type: PulseChannelType = "instagram"


class PulseMetaOAuthCompleteResponse(BaseModel):
    channels: list[PulseChannelRecord]
    message: str


class PulseChannelCapabilityMatrixItem(BaseModel):
    channel_type: PulseChannelType
    name: str
    tier: Literal["first_class", "limited", "partner_gated"]
    description: str
    docsUrl: str
    capabilities: list[PulseChannelCapability]


class PulseChannelsResponse(BaseModel):
    channels: list[PulseChannelRecord]
    capabilityMatrix: list[PulseChannelCapabilityMatrixItem]


class PulseContactRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    channel_id: str
    external_user_id: str
    username: str | None = None
    display_name: str
    fields: dict[str, Any] = Field(default_factory=dict)
    consent_state: str = "unknown"
    tags: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class PulseConversationRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    channel_id: str
    contact_id: str
    channel_type: PulseChannelType
    channel_name: str
    contact_name: str
    state: PulseConversationState = "automated"
    window_expires_at: str | None = None
    last_inbound_at: str | None = None
    last_outbound_at: str | None = None
    last_message: str | None = None
    unread: int = 0
    created_at: str
    updated_at: str


class PulseMessageRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    conversation_id: str
    direction: PulseMessageDirection
    body: str = ""
    media: list[dict[str, Any]] = Field(default_factory=list)
    provider_message_id: str | None = None
    status: str = "received"
    created_at: str
    updated_at: str


class PulseConversationDetailResponse(BaseModel):
    conversation: PulseConversationRecord
    contact: PulseContactRecord
    messages: list[PulseMessageRecord]


class PulseConversationsResponse(BaseModel):
    conversations: list[PulseConversationRecord]


class PulseSendMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class PulseConversationStateRequest(BaseModel):
    state: PulseConversationState


class PulseFlowNode(BaseModel):
    id: str
    kind: Literal[
        "trigger",
        "send_message",
        "ask_question",
        "wait",
        "condition",
        "set_tag",
        "set_field",
        "ai_reply",
        "composio_action",
        "handoff",
        "end",
    ]
    label: str = ""
    config: dict[str, Any] = Field(default_factory=dict)


class PulseFlowEdge(BaseModel):
    id: str
    source: str
    target: str
    condition: str | None = None


class PulseFlowDefinition(BaseModel):
    nodes: list[PulseFlowNode] = Field(default_factory=list)
    edges: list[PulseFlowEdge] = Field(default_factory=list)


class PulseAutomationRecord(BaseModel):
    id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    name: str
    channel_type: PulseChannelType
    enabled: bool = False
    flow: PulseFlowDefinition = Field(default_factory=PulseFlowDefinition)
    version: int = 1
    created_at: str
    updated_at: str


class PulseAutomationCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    channel_type: PulseChannelType
    flow: PulseFlowDefinition = Field(default_factory=PulseFlowDefinition)
    enabled: bool = False


class PulseAutomationUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    channel_type: PulseChannelType | None = None
    flow: PulseFlowDefinition | None = None
    enabled: bool | None = None


class PulseAutomationToggleRequest(BaseModel):
    enabled: bool


class PulseAutomationListResponse(BaseModel):
    automations: list[PulseAutomationRecord]


class PulseAutomationGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    channel_type: PulseChannelType = "instagram"


class PulseAutomationSimulateRequest(BaseModel):
    automation_id: str | None = None
    flow: PulseFlowDefinition | None = None
    message: str = Field(default="I want to learn more", max_length=4000)


class PulseAutomationSimulateResponse(BaseModel):
    transcript: list[PulseMessageRecord]
    context: dict[str, Any] = Field(default_factory=dict)


class PulseTagRecord(BaseModel):
    id: str
    name: str
    color: str = "primary"
    created_at: str
    updated_at: str


class PulseTagsResponse(BaseModel):
    tags: list[PulseTagRecord]


class PulseAnalyticsResponse(BaseModel):
    totals: dict[str, int] = Field(default_factory=dict)
    channelBreakdown: list[dict[str, Any]] = Field(default_factory=list)
    recentRuns: list[dict[str, Any]] = Field(default_factory=list)


class PulseWebhookIngestResponse(BaseModel):
    ok: bool = True
    eventId: str | None = None
    processed: bool = False


class ComposioConnectedAccount(BaseModel):
    id: str
    appSlug: str
    status: str
    createdAt: str | None = None


class ComposioToolPreview(BaseModel):
    slug: str
    name: str
    description: str = ""


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


class PostizWorkspaceRecord(BaseModel):
    id: str
    workspaceId: str
    agentId: str
    postizOrgId: str = ""
    postizUserId: str = ""
    status: str = "disabled"
    message: str = ""
    createdAt: str
    updatedAt: str


class PostizToolBridgeStatus(BaseModel):
    changed: bool = False
    configured: bool = False
    enabled: bool = False
    message: str = ""
    serverName: str = "postiz"


class PostizStatusResponse(BaseModel):
    configured: bool
    publicUrl: str = ""
    channelCount: int = 0
    health: dict[str, Any] = Field(default_factory=dict)
    binding: PostizWorkspaceRecord | None = None
    toolBridge: PostizToolBridgeStatus | None = None


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


class WorkflowAgentsResponse(BaseModel):
    agents: list[WorkflowAgentRecord]


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


class WorkflowAgentSetupApprovalRequest(BaseModel):
    status: WorkflowSetupApprovalStatus
    approval_ids: list[str] = Field(default_factory=list)


class WorkflowAgentSetupApprovalResponse(BaseModel):
    approvals: list[WorkflowAgentSetupApprovalRecord]


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
    description: str = ""
    category: str = ""
    source: str = "hermes"
    enabled: bool = True


class WorkflowToolCapabilitiesResponse(BaseModel):
    tools: list[WorkflowToolCapability]
    errors: list[str] = Field(default_factory=list)


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


class WorkflowRunsResponse(BaseModel):
    runs: list[WorkflowRunRecord]


class WorkflowTriggerRunsResponse(BaseModel):
    runs: list[WorkflowRunRecord]


class WorkflowRunEventsResponse(BaseModel):
    events: list[WorkflowRunEventRecord]


class WorkflowWebhookIngestResponse(BaseModel):
    run: WorkflowRunRecord


class BootstrapResponse(BaseModel):
    workspace: Workspace
    profile: AgentProfile
    audit_log: list[AuditEvent]
    runs: list[RunRecord]
    runtime: RuntimeStatus
    hermes: HermesRuntimeMetadata
