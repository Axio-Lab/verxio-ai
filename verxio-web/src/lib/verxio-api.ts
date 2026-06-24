export interface VerxioUser {
  id: string
  email: string
  name: string
}

export interface VerxioWorkspace {
  id: string
  tenant_id: string
  slug: string
  name: string
  owner: string
  kind: string
  plan: string
}

export interface VerxioAgent {
  id: string
  workspace_id: string
  tenant_id: string
  name: string
  role: string
  status: string
}

export interface VerxioAuthResponse {
  user: VerxioUser
  workspace: VerxioWorkspace
  profile: VerxioAgent
}

export type VerxioAuthCodePurpose = 'email_verify' | 'login' | 'password_reset'

export interface VerxioAuthCodeChallengeResponse {
  ok: boolean
  email: string
  purpose: VerxioAuthCodePurpose
  expiresInSeconds: number
}

export interface VerxioArtifact {
  id: string
  workspace_id: string
  agent_id: string
  file_name: string
  relative_path: string
  content_type: string
  size_bytes: number
  sha256: string | null
  created_at: string
  updated_at: string
}

export interface VerxioArtifactListResponse {
  artifacts: VerxioArtifact[]
}

export interface VerxioNotepadFolder {
  id: string
  tenant_id: string
  workspace_id: string
  agent_id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface VerxioNotepadNote {
  id: string
  tenant_id: string
  workspace_id: string
  agent_id: string
  folder_id: string | null
  title: string
  content: string
  transcript: string
  summary: string
  meeting_type: string
  source: string
  share_token: string | null
  created_at: string
  updated_at: string
}

export interface VerxioNotepadListResponse {
  folders: VerxioNotepadFolder[]
  notes: VerxioNotepadNote[]
}

export interface VerxioNotepadShareResponse {
  token: string
  url: string
  note: VerxioNotepadNote
}

export interface VerxioPublicNotepadShareResponse {
  note: VerxioNotepadNote
  folder: VerxioNotepadFolder | null
  workspace_name: string
}

export interface VerxioNotepadNoteInput {
  title?: string
  folder_id?: string | null
  content?: string
  transcript?: string
  summary?: string
  meeting_type?: string
  source?: string
}

export interface ComposioConnectedAccount {
  id: string
  appSlug: string
  status: string
  createdAt?: string
}

export interface ComposioToolPreview {
  slug: string
  name: string
  description: string
}

export interface ComposioToolBridgeStatus {
  configured: boolean
  enabled: boolean
  changed?: boolean
  serverName: string
  connectedApps: string[]
  message?: string | null
}

export type ComposioAuthMode = 'no_auth' | 'managed_oauth' | 'connect_link' | 'requires_oauth_app'

export interface ComposioApp {
  slug: string
  name: string
  description: string
  logoUrl: string | null
  categories: string[]
  noAuth: boolean
  authMode?: ComposioAuthMode
  authSchemes?: string[]
  connectable?: boolean
  toolsCount?: number | null
  triggersCount?: number | null
  sampleTools?: ComposioToolPreview[]
}

export interface ComposioAuthInputField {
  name: string
  displayName: string
  type: string
  description: string
  required: boolean
  isSecret: boolean
}

export interface ComposioConnectionSetupResponse {
  appSlug: string
  name: string
  authMode: ComposioAuthMode
  authScheme: string | null
  supportsInline: boolean
  supportsLink: boolean
  inputFields: ComposioAuthInputField[]
}

export interface ComposioConnectionsResponse {
  accounts: ComposioConnectedAccount[]
  configured: boolean
  toolBridge?: ComposioToolBridgeStatus | null
}

export interface ComposioAppsResponse {
  apps: ComposioApp[]
  configured: boolean
  catalogReady?: boolean
  catalogError?: string | null
}

export interface ComposioAppToolsResponse {
  tools: ComposioToolPreview[]
  configured: boolean
  catalogReady?: boolean
  catalogError?: string | null
}

export interface ComposioInitiateResponse {
  redirectUrl: string | null
  connectionId: string
}

export interface ComposioCompleteConnectionResponse {
  connectionId: string
  status: string
}

export type PulseChannelType = 'instagram' | 'messenger' | 'whatsapp' | 'tiktok' | 'linkedin'
export type PulseConversationState = 'automated' | 'human' | 'paused'

export interface PulseChannelCapability {
  key: string
  label: string
  supported: boolean
  description?: string
  gated?: boolean
}

export interface PulseChannelCapabilityMatrixItem {
  channel_type: PulseChannelType
  name: string
  tier: 'first_class' | 'limited' | 'partner_gated'
  description: string
  docsUrl: string
  capabilities: PulseChannelCapability[]
}

export interface PulseChannel {
  id: string
  channel_type: PulseChannelType
  external_id: string
  display_name: string
  status: string
  capabilities: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PulseChannelsResponse {
  channels: PulseChannel[]
  capabilityMatrix: PulseChannelCapabilityMatrixItem[]
}

export interface PulseChannelConnectResponse {
  channel?: PulseChannel | null
  redirectUrl?: string | null
  message: string
}

export interface PulseMetaOAuthCompleteResponse {
  channels: PulseChannel[]
  message: string
}

export interface PulseConversation {
  id: string
  channel_id: string
  contact_id: string
  channel_type: PulseChannelType
  channel_name: string
  contact_name: string
  state: PulseConversationState
  window_expires_at?: string | null
  last_inbound_at?: string | null
  last_outbound_at?: string | null
  last_message?: string | null
  unread: number
  created_at: string
  updated_at: string
}

export interface PulseContact {
  id: string
  external_user_id: string
  username?: string | null
  display_name: string
  fields: Record<string, unknown>
  consent_state: string
  tags: string[]
  created_at: string
  updated_at: string
}

export interface PulseMessage {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound' | 'system'
  body: string
  media: Array<Record<string, unknown>>
  provider_message_id?: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface PulseConversationsResponse {
  conversations: PulseConversation[]
}

export interface PulseConversationDetailResponse {
  conversation: PulseConversation
  contact: PulseContact
  messages: PulseMessage[]
}

export interface PulseFlowNode {
  id: string
  kind:
    | 'trigger'
    | 'send_message'
    | 'ask_question'
    | 'wait'
    | 'condition'
    | 'set_tag'
    | 'set_field'
    | 'ai_reply'
    | 'composio_action'
    | 'handoff'
    | 'end'
  label: string
  config: Record<string, unknown>
}

export interface PulseFlowEdge {
  id: string
  source: string
  target: string
  condition?: string | null
}

export interface PulseFlowDefinition {
  nodes: PulseFlowNode[]
  edges: PulseFlowEdge[]
}

export interface PulseAutomation {
  id: string
  name: string
  channel_type: PulseChannelType
  enabled: boolean
  flow: PulseFlowDefinition
  version: number
  created_at: string
  updated_at: string
}

export interface PulseAutomationListResponse {
  automations: PulseAutomation[]
}

export interface PulseAnalyticsResponse {
  totals: Record<string, number>
  channelBreakdown: Array<Record<string, unknown>>
  recentRuns: Array<Record<string, unknown>>
}

export interface PulseAutomationSimulateResponse {
  transcript: PulseMessage[]
  context: Record<string, unknown>
}

export function verxioApiBaseUrl(): string {
  return import.meta.env.VITE_VERXIO_API_URL?.replace(/\/$/, '') ?? ''
}

export function verxioApiEnabled(): boolean {
  const flag = String(import.meta.env.VITE_VERXIO_API_ENABLED ?? '').toLowerCase()
  const directHermesUrl = import.meta.env.VITE_HERMES_DASHBOARD_URL?.trim()

  if (flag === '0' || flag === 'false') {
    return false
  }

  if (flag === '1' || flag === 'true' || Boolean(verxioApiBaseUrl())) {
    return true
  }

  return !directHermesUrl
}

export function verxioApiUrl(path: string): string {
  const base = verxioApiBaseUrl()
  const normalized = path.startsWith('/') ? path : `/${path}`

  return `${base}${normalized}`
}

export async function verxioFetch<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController()
  const { timeoutMs, ...requestInit } = init
  let timeoutId: number | undefined

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  }

  try {
    const response = await fetch(verxioApiUrl(path), {
      ...requestInit,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(requestInit.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(requestInit.headers ?? {})
      }
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')

      if (detail) {
        try {
          const parsed = JSON.parse(detail) as { detail?: unknown; message?: unknown }

          if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
            throw new Error(parsed.detail.trim())
          }

          if (typeof parsed.message === 'string' && parsed.message.trim()) {
            throw new Error(parsed.message.trim())
          }
        } catch (error) {
          if (error instanceof Error && error.message !== detail) {
            throw error
          }
        }
      }

      throw new Error(detail || `${response.status} ${response.statusText}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. Try a shorter recording and transcribe again.')
    }

    throw error
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
    }
  }
}

export interface VerxioRuntimeControlResponse {
  runtime: {
    id: string
    workspace_path: string
    artifact_path: string
    status: string
  }
  connected: boolean
  detail: string
}

export function syncRuntimeWorkspace(workspacePath: string): Promise<VerxioRuntimeControlResponse> {
  return verxioFetch<VerxioRuntimeControlResponse>('/api/runtime/workspace', {
    body: JSON.stringify({ workspace_path: workspacePath }),
    method: 'POST'
  })
}

export function authMe(): Promise<VerxioAuthResponse> {
  return verxioFetch<VerxioAuthResponse>('/api/auth/me')
}

export function authLogin(email: string, password: string): Promise<VerxioAuthResponse> {
  return verxioFetch<VerxioAuthResponse>('/api/auth/login', {
    body: JSON.stringify({ email, password }),
    method: 'POST'
  })
}

export function authSignup(
  email: string,
  password: string,
  displayName?: string
): Promise<VerxioAuthCodeChallengeResponse> {
  return verxioFetch<VerxioAuthCodeChallengeResponse>('/api/auth/signup', {
    body: JSON.stringify({ email, name: displayName || email.split('@')[0] || 'Verxio User', password }),
    method: 'POST'
  })
}

export function authVerifyEmail(email: string, code: string): Promise<VerxioAuthResponse> {
  return verxioFetch<VerxioAuthResponse>('/api/auth/verify-email', {
    body: JSON.stringify({ email, code }),
    method: 'POST'
  })
}

export function authResendVerification(email: string): Promise<VerxioAuthCodeChallengeResponse> {
  return verxioFetch<VerxioAuthCodeChallengeResponse>('/api/auth/verification/resend', {
    body: JSON.stringify({ email }),
    method: 'POST'
  })
}

export function authRequestLoginCode(email: string): Promise<VerxioAuthCodeChallengeResponse> {
  return verxioFetch<VerxioAuthCodeChallengeResponse>('/api/auth/login/code/request', {
    body: JSON.stringify({ email }),
    method: 'POST'
  })
}

export function authVerifyLoginCode(email: string, code: string): Promise<VerxioAuthResponse> {
  return verxioFetch<VerxioAuthResponse>('/api/auth/login/code/verify', {
    body: JSON.stringify({ email, code }),
    method: 'POST'
  })
}

export function authForgotPassword(email: string): Promise<VerxioAuthCodeChallengeResponse> {
  return verxioFetch<VerxioAuthCodeChallengeResponse>('/api/auth/password/forgot', {
    body: JSON.stringify({ email }),
    method: 'POST'
  })
}

export function authResetPassword(email: string, code: string, password: string): Promise<VerxioAuthResponse> {
  return verxioFetch<VerxioAuthResponse>('/api/auth/password/reset', {
    body: JSON.stringify({ email, code, password }),
    method: 'POST'
  })
}

export function authLogout(): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export function listVerxioArtifacts(): Promise<VerxioArtifactListResponse> {
  return verxioFetch<VerxioArtifactListResponse>('/api/artifacts')
}

export function listNotepad(): Promise<VerxioNotepadListResponse> {
  return verxioFetch<VerxioNotepadListResponse>('/api/notepad')
}

export function createNotepadFolder(name: string): Promise<VerxioNotepadFolder> {
  return verxioFetch<VerxioNotepadFolder>('/api/notepad/folders', {
    body: JSON.stringify({ name }),
    method: 'POST'
  })
}

export function deleteNotepadFolder(folderId: string): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>(`/api/notepad/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE'
  })
}

export function createNotepadNote(input: VerxioNotepadNoteInput): Promise<VerxioNotepadNote> {
  return verxioFetch<VerxioNotepadNote>('/api/notepad/notes', {
    body: JSON.stringify(input),
    method: 'POST'
  })
}

export function updateNotepadNote(noteId: string, input: VerxioNotepadNoteInput): Promise<VerxioNotepadNote> {
  return verxioFetch<VerxioNotepadNote>(`/api/notepad/notes/${encodeURIComponent(noteId)}`, {
    body: JSON.stringify(input),
    method: 'PATCH'
  })
}

export function deleteNotepadNote(noteId: string): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>(`/api/notepad/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE'
  })
}

export function summarizeNotepadNote(noteId: string): Promise<VerxioNotepadNote> {
  return verxioFetch<VerxioNotepadNote>(`/api/notepad/notes/${encodeURIComponent(noteId)}/summarize`, {
    method: 'POST'
  })
}

export function shareNotepadNote(noteId: string): Promise<VerxioNotepadShareResponse> {
  return verxioFetch<VerxioNotepadShareResponse>(`/api/notepad/notes/${encodeURIComponent(noteId)}/share`, {
    method: 'POST'
  })
}

export function revokeNotepadShare(noteId: string): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>(`/api/notepad/notes/${encodeURIComponent(noteId)}/share`, {
    method: 'DELETE'
  })
}

export async function getPublicNotepadShare(token: string): Promise<VerxioPublicNotepadShareResponse> {
  const response = await fetch(verxioApiUrl(`/api/public/notepad/${encodeURIComponent(token)}`), {
    credentials: 'omit'
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return (await response.json()) as VerxioPublicNotepadShareResponse
}

export function listComposioConnections(): Promise<ComposioConnectionsResponse> {
  return verxioFetch<ComposioConnectionsResponse>('/api/composio/connections')
}

export function listComposioApps(): Promise<ComposioAppsResponse> {
  return verxioFetch<ComposioAppsResponse>('/api/composio/connections/apps')
}

export function listComposioAppTools(appSlug: string, limit = 4): Promise<ComposioAppToolsResponse> {
  return verxioFetch<ComposioAppToolsResponse>(
    `/api/composio/connections/apps/${encodeURIComponent(appSlug)}/tools?limit=${limit}`
  )
}

export function getComposioConnectionSetup(appSlug: string): Promise<ComposioConnectionSetupResponse> {
  return verxioFetch<ComposioConnectionSetupResponse>(
    `/api/composio/connections/apps/${encodeURIComponent(appSlug)}/setup`
  )
}

export function initiateComposioConnection(appSlug: string, callbackUrl?: string): Promise<ComposioInitiateResponse> {
  return verxioFetch<ComposioInitiateResponse>('/api/composio/connections/initiate', {
    body: JSON.stringify({ appSlug, callbackUrl }),
    method: 'POST'
  })
}

export function completeComposioConnection(
  appSlug: string,
  credentials: Record<string, string>
): Promise<ComposioCompleteConnectionResponse> {
  return verxioFetch<ComposioCompleteConnectionResponse>('/api/composio/connections/complete', {
    body: JSON.stringify({ appSlug, credentials }),
    method: 'POST'
  })
}

export function disconnectComposioAccount(accountId: string): Promise<{ message?: string }> {
  return verxioFetch<{ message?: string }>(`/api/composio/connections/${encodeURIComponent(accountId)}`, {
    method: 'DELETE'
  })
}

export function listPulseChannels(): Promise<PulseChannelsResponse> {
  return verxioFetch<PulseChannelsResponse>('/api/pulse/channels')
}

export function connectPulseChannel(
  channelType: PulseChannelType,
  input: {
    callbackUrl?: string
    credentials?: Record<string, string>
    display_name?: string
    external_id?: string
  } = {}
): Promise<PulseChannelConnectResponse> {
  return verxioFetch<PulseChannelConnectResponse>('/api/pulse/channels/connect', {
    body: JSON.stringify({ channel_type: channelType, ...input }),
    method: 'POST'
  })
}

export function completePulseMetaOAuth(
  code: string,
  redirectUri: string,
  channelType: PulseChannelType
): Promise<PulseMetaOAuthCompleteResponse> {
  return verxioFetch<PulseMetaOAuthCompleteResponse>('/api/pulse/channels/meta/complete', {
    body: JSON.stringify({ channel_type: channelType, code, redirectUri }),
    method: 'POST'
  })
}

export function deletePulseChannel(channelId: string): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>(`/api/pulse/channels/${encodeURIComponent(channelId)}`, {
    method: 'DELETE'
  })
}

export function listPulseConversations(): Promise<PulseConversationsResponse> {
  return verxioFetch<PulseConversationsResponse>('/api/pulse/conversations')
}

export function getPulseConversation(conversationId: string): Promise<PulseConversationDetailResponse> {
  return verxioFetch<PulseConversationDetailResponse>(`/api/pulse/conversations/${encodeURIComponent(conversationId)}`)
}

export function sendPulseMessage(conversationId: string, body: string): Promise<PulseMessage> {
  return verxioFetch<PulseMessage>(`/api/pulse/conversations/${encodeURIComponent(conversationId)}/messages`, {
    body: JSON.stringify({ body }),
    method: 'POST'
  })
}

export function updatePulseConversationState(
  conversationId: string,
  state: PulseConversationState
): Promise<PulseConversation> {
  return verxioFetch<PulseConversation>(`/api/pulse/conversations/${encodeURIComponent(conversationId)}/state`, {
    body: JSON.stringify({ state }),
    method: 'POST'
  })
}

export function listPulseAutomations(): Promise<PulseAutomationListResponse> {
  return verxioFetch<PulseAutomationListResponse>('/api/pulse/automations')
}

export function createPulseAutomation(input: {
  channel_type: PulseChannelType
  enabled?: boolean
  flow?: PulseFlowDefinition
  name: string
}): Promise<PulseAutomation> {
  return verxioFetch<PulseAutomation>('/api/pulse/automations', {
    body: JSON.stringify(input),
    method: 'POST'
  })
}

export function updatePulseAutomation(automationId: string, input: Partial<PulseAutomation>): Promise<PulseAutomation> {
  return verxioFetch<PulseAutomation>(`/api/pulse/automations/${encodeURIComponent(automationId)}`, {
    body: JSON.stringify(input),
    method: 'PUT'
  })
}

export function togglePulseAutomation(automationId: string, enabled: boolean): Promise<PulseAutomation> {
  return verxioFetch<PulseAutomation>(`/api/pulse/automations/${encodeURIComponent(automationId)}/enable`, {
    body: JSON.stringify({ enabled }),
    method: 'POST'
  })
}

export function deletePulseAutomation(automationId: string): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>(`/api/pulse/automations/${encodeURIComponent(automationId)}`, {
    method: 'DELETE'
  })
}

export function generatePulseAutomation(prompt: string, channelType: PulseChannelType): Promise<PulseAutomation> {
  return verxioFetch<PulseAutomation>('/api/pulse/automations/generate', {
    body: JSON.stringify({ channel_type: channelType, prompt }),
    method: 'POST'
  })
}

export function simulatePulseAutomation(input: {
  automation_id?: string
  flow?: PulseFlowDefinition
  message?: string
}): Promise<PulseAutomationSimulateResponse> {
  return verxioFetch<PulseAutomationSimulateResponse>('/api/pulse/automations/simulate', {
    body: JSON.stringify(input),
    method: 'POST'
  })
}

export function getPulseAnalytics(): Promise<PulseAnalyticsResponse> {
  return verxioFetch<PulseAnalyticsResponse>('/api/pulse/analytics')
}
