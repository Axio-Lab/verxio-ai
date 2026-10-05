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
  source: string
  created_at: string
  updated_at: string
}

export interface VerxioArtifactListResponse {
  artifacts: VerxioArtifact[]
}

export interface VerxioNotepadRecordingUploadInput {
  file_name: string
  data_url: string
  mime_type?: string
}

export interface VerxioNotepadRecordingUploadResponse {
  artifact: VerxioArtifact
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
  inputParameters: Record<string, unknown>
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

export interface ComposioMcpSessionResponse {
  configured: boolean
  connectedApps?: string[]
  enabled: boolean
  agentPrompt?: string
  mcpApiKey?: string | null
  mcpUrl?: string | null
  message?: string | null
  prompt?: string
  publicWebUrl?: string | null
  serverName?: string
  soulPrompt?: string
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

export interface ComposioTriggerType {
  slug: string
  name: string
  description: string
  config: Record<string, unknown>
  payload: Record<string, unknown>
}

export interface ComposioTriggerTypesResponse {
  triggers: ComposioTriggerType[]
  configured: boolean
}

export interface ComposioInitiateResponse {
  redirectUrl: string | null
  connectionId: string
}

export interface ComposioCompleteConnectionResponse {
  connectionId: string
  status: string
}

export type VerxioInferenceMode = 'hosted' | 'byok'

export interface VerxioInferenceCapability {
  key: string
  label: string
}

export interface VerxioInferencePricing {
  inputPerMillion: number
  outputPerMillion: number
  currency: string
}

export interface VerxioInferenceModel {
  id: string
  displayName: string
  description: string
  providerSlug: string
  upstreamModelId: string
  availableModelIds?: string[]
  requiredEnvVars: string[]
  hostedAvailable: boolean
  byokAvailable: boolean
  tier: string
  capabilities: VerxioInferenceCapability[]
  pricing: VerxioInferencePricing
  default: boolean
}

export interface VerxioInferenceCatalogResponse {
  models: VerxioInferenceModel[]
  defaultModelId: string
}

export interface VerxioInferenceSettings {
  mode: VerxioInferenceMode
  defaultModelId: string
  monthlyCreditUsd: number
  overageEnabled: boolean
  spendingLimitUsd: number | null
}

export interface VerxioInferenceUsageSummary {
  periodStart: string | null
  periodEnd: string | null
  monthlyCreditUsd: number
  usedUsd: number
  remainingUsd: number
  events: number
}

export interface VerxioInferenceUsageResponse {
  settings: VerxioInferenceSettings
  usage: VerxioInferenceUsageSummary
}

export interface VerxioTranscriptionCatalogModel {
  id: string
  source: 'fallback' | 'provider'
}

export interface VerxioTranscriptionCatalogProvider {
  id: 'elevenlabs' | 'groq' | 'mistral' | 'openai' | 'xai'
  label: string
  envKey: string
  docsUrl: string
  description: string
  configured: boolean
  recommendedModel: string
  models: VerxioTranscriptionCatalogModel[]
  source: 'fallback' | 'provider'
  error?: string | null
  fetchedAt?: string | null
}

export interface VerxioTranscriptionCatalogResponse {
  providers: VerxioTranscriptionCatalogProvider[]
  cacheTtlSeconds: number
}

export function verxioApiBaseUrl(): string {
  const baked = import.meta.env.VITE_VERXIO_API_URL?.replace(/\/$/, '') ?? ''

  if (baked) {
    return baked
  }

  if (typeof window !== 'undefined' && typeof window.hermesDesktop?.verxioApiBaseUrl === 'function') {
    return window.hermesDesktop.verxioApiBaseUrl().replace(/\/$/, '')
  }

  return ''
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
        let parsedMessage = ''

        try {
          const parsed = JSON.parse(detail) as { detail?: unknown; message?: unknown }

          if (typeof parsed.detail === 'string' && parsed.detail.trim()) {
            parsedMessage = parsed.detail.trim()
          }

          if (typeof parsed.message === 'string' && parsed.message.trim()) {
            parsedMessage = parsed.message.trim()
          }
        } catch {
          parsedMessage = ''
        }

        if (parsedMessage) {
          throw new Error(parsedMessage)
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
      throw new Error('Request timed out. Please try again.')
    }

    throw error
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
    }
  }
}

export type VerxioRuntimePhase =
  | 'attaching_profile'
  | 'failed'
  | 'preparing_env'
  | 'queued'
  | 'ready'
  | 'restoring_home'
  | 'starting'
  | 'stopped'

export interface VerxioRuntimeControlResponse {
  runtime: {
    id: string
    workspace_path: string
    artifact_path: string
    status: string
  }
  connected: boolean
  detail: string
  /** Spin-up step reported by the pool worker (see app/runtime_phase.py). */
  phase?: VerxioRuntimePhase | null
  phase_detail?: string | null
}

export function syncRuntimeWorkspace(workspacePath: string): Promise<VerxioRuntimeControlResponse> {
  return verxioFetch<VerxioRuntimeControlResponse>('/api/runtime/workspace', {
    body: JSON.stringify({ workspace_path: workspacePath }),
    method: 'POST'
  })
}

export function restartVerxioRuntime(): Promise<VerxioRuntimeControlResponse> {
  return verxioFetch<VerxioRuntimeControlResponse>('/api/runtime/restart', {
    method: 'POST'
  })
}

export function getVerxioRuntime(): Promise<VerxioRuntimeControlResponse> {
  return verxioFetch<VerxioRuntimeControlResponse>('/api/runtime')
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

export function authSignupInvite(): Promise<{ invite_code: string }> {
  return verxioFetch<{ invite_code: string }>('/api/auth/signup-invite')
}

export function authSignup(
  email: string,
  password: string,
  displayName: string | undefined,
  inviteCode: string
): Promise<VerxioAuthCodeChallengeResponse> {
  return verxioFetch<VerxioAuthCodeChallengeResponse>('/api/auth/signup', {
    body: JSON.stringify({
      email,
      invite_code: inviteCode.trim(),
      name: displayName || email.split('@')[0] || 'Verxio User',
      password
    }),
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

let artifactsListCache: { at: number; promise: Promise<VerxioArtifactListResponse> } | null = null
const ARTIFACTS_LIST_CACHE_MS = 15_000

export function listVerxioArtifacts(options?: { refresh?: boolean }): Promise<VerxioArtifactListResponse> {
  const now = Date.now()

  if (!options?.refresh && artifactsListCache && now - artifactsListCache.at < ARTIFACTS_LIST_CACHE_MS) {
    return artifactsListCache.promise
  }

  const promise = verxioFetch<VerxioArtifactListResponse>('/api/artifacts', {
    // Indexing can take a while after React scaffolds; don't abort early.
    timeoutMs: 60_000
  }).catch(error => {
    if (artifactsListCache?.promise === promise) {
      artifactsListCache = null
    }

    throw error
  })

  artifactsListCache = { at: now, promise }

  return promise
}

export function deleteVerxioArtifact(artifactId: string): Promise<{ ok: boolean }> {
  artifactsListCache = null

  return verxioFetch<{ ok: boolean }>(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
    method: 'DELETE'
  })
}

export async function deleteVerxioArtifacts(artifactIds: string[]): Promise<{ failed: string[]; deleted: string[] }> {
  const deleted: string[] = []
  const failed: string[] = []

  for (const artifactId of artifactIds) {
    try {
      await deleteVerxioArtifact(artifactId)
      deleted.push(artifactId)
    } catch {
      failed.push(artifactId)
    }
  }

  return { deleted, failed }
}

export function listNotepad(): Promise<VerxioNotepadListResponse> {
  return verxioFetch<VerxioNotepadListResponse>('/api/notepad')
}

export function uploadNotepadRecording(
  input: VerxioNotepadRecordingUploadInput
): Promise<VerxioNotepadRecordingUploadResponse> {
  return verxioFetch<VerxioNotepadRecordingUploadResponse>('/api/notepad/recordings', {
    body: JSON.stringify(input),
    method: 'POST',
    timeoutMs: 300_000
  })
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

export function createComposioMcpSession(): Promise<ComposioMcpSessionResponse> {
  return verxioFetch<ComposioMcpSessionResponse>('/api/composio/mcp-session', { method: 'POST' })
}

export function createDeviceToken(name = 'Verxio Desktop'): Promise<{ token: string }> {
  return verxioFetch<{ token: string }>('/api/auth/device', {
    body: JSON.stringify({ name, platform: 'desktop' }),
    method: 'POST'
  })
}

export function listComposioApps(): Promise<ComposioAppsResponse> {
  return verxioFetch<ComposioAppsResponse>('/api/composio/connections/apps')
}

export function listComposioAppTools(appSlug: string, limit = 4): Promise<ComposioAppToolsResponse> {
  return verxioFetch<ComposioAppToolsResponse>(
    `/api/composio/connections/apps/${encodeURIComponent(appSlug)}/tools?limit=${limit}`
  )
}

export function listComposioTriggerTypes(appSlug: string): Promise<ComposioTriggerTypesResponse> {
  return verxioFetch<ComposioTriggerTypesResponse>(
    `/api/composio/connections/apps/${encodeURIComponent(appSlug)}/triggers`
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

export function getInferenceCatalog(): Promise<VerxioInferenceCatalogResponse> {
  return verxioFetch<VerxioInferenceCatalogResponse>('/api/inference/catalog')
}

export function getInferenceSettings(): Promise<VerxioInferenceSettings> {
  return verxioFetch<VerxioInferenceSettings>('/api/inference/settings')
}

export function updateInferenceSettings(input: {
  defaultModelId?: string
  mode?: VerxioInferenceMode
  overageEnabled?: boolean
  spendingLimitUsd?: number | null
}): Promise<VerxioInferenceSettings> {
  return verxioFetch<VerxioInferenceSettings>('/api/inference/settings', {
    body: JSON.stringify(input),
    method: 'PUT'
  })
}

export function getInferenceUsage(): Promise<VerxioInferenceUsageResponse> {
  return verxioFetch<VerxioInferenceUsageResponse>('/api/inference/usage')
}

export function listVerxioTranscriptionCatalog(refresh = false): Promise<VerxioTranscriptionCatalogResponse> {
  return verxioFetch<VerxioTranscriptionCatalogResponse>(
    `/api/transcription/catalog${refresh ? '?refresh=true' : ''}`,
    {
      timeoutMs: 12_000
    }
  )
}

export interface TavusProfile {
  configured: boolean
  displayName: string
  tone: string
  neverDo: string
  spokenPrompt: string
  language: string
  region: string
  faceId: string
  voiceId: string
  palId: string
  conferencingUsername: string
  meetingAllowlist: string[]
  shareUrl: string
  internetSearch: boolean
  magicCanvas: boolean
  monthlyMinuteBudget: number
  minutesUsed: number
  taskToolReady: boolean
  personalityPrompt: string
}

export interface TavusVoice {
  id: string
  name: string
  type: string
  status: string
}

export interface TavusFace {
  id: string
  name: string
  status: string
}

export interface TavusConversationStart {
  conversationId: string
  conversationUrl: string
  meetingToken: string
  kind: string
}

export interface TavusTask {
  id: string
  conversationId: string
  instruction: string
  status: string
  hermesSessionId: string
  resultText: string
}

export function getTavusProfile(): Promise<TavusProfile> {
  return verxioFetch<TavusProfile>('/api/tavus/profile')
}

export function saveTavusProfile(input: Partial<TavusProfile>): Promise<TavusProfile> {
  return verxioFetch<TavusProfile>('/api/tavus/profile', { body: JSON.stringify(input), method: 'PUT' })
}

export function deleteTavusProfile(): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>('/api/tavus/profile', { method: 'DELETE' })
}

export function listTavusVoices(): Promise<{ voices: TavusVoice[] }> {
  return verxioFetch<{ voices: TavusVoice[] }>('/api/tavus/voices')
}

export function listTavusFaces(): Promise<{ faces: TavusFace[] }> {
  return verxioFetch<{ faces: TavusFace[] }>('/api/tavus/faces')
}

export function startTavusConversation(input: {
  audioOnly?: boolean
  kind?: string
  meetingUrl?: string
}): Promise<TavusConversationStart> {
  return verxioFetch<TavusConversationStart>('/api/tavus/conversations', {
    body: JSON.stringify(input),
    method: 'POST'
  })
}

export function endTavusConversation(conversationId: string): Promise<{ ok: string }> {
  return verxioFetch<{ ok: string }>(`/api/tavus/conversations/${encodeURIComponent(conversationId)}/end`, {
    method: 'POST'
  })
}

export function nextTavusTask(wait = 25): Promise<{ task: TavusTask | null }> {
  return verxioFetch<{ task: TavusTask | null }>(`/api/tavus/tasks/next?wait=${wait}`, { timeoutMs: (wait + 5) * 1000 })
}

export function updateTavusTask(
  taskId: string,
  input: { hermesSessionId?: string; resultText?: string; status: string }
): Promise<TavusTask> {
  return verxioFetch<TavusTask>(`/api/tavus/tasks/${encodeURIComponent(taskId)}`, {
    body: JSON.stringify(input),
    method: 'POST'
  })
}

export function listTavusCalls(): Promise<{ calls: Array<Record<string, unknown>> }> {
  return verxioFetch('/api/tavus/calls')
}

export function listTavusMemories(): Promise<{ facts: Array<{ id: string; text: string }>; learned: string }> {
  return verxioFetch('/api/tavus/memories')
}

export function addTavusMemory(text: string): Promise<{ facts: Array<{ id: string; text: string }> }> {
  return verxioFetch('/api/tavus/memories', { body: JSON.stringify({ text }), method: 'POST' })
}

export function deleteTavusMemory(factId: string): Promise<{ facts: Array<{ id: string; text: string }> }> {
  return verxioFetch(`/api/tavus/memories/${encodeURIComponent(factId)}`, { method: 'DELETE' })
}

export function listTavusDocuments(): Promise<{
  documents: Array<{ documentId: string; id: string; name: string; status: string }>
}> {
  return verxioFetch('/api/tavus/documents')
}

export function createTavusDocument(input: {
  crawlDepth?: number
  maxPages?: number
  name: string
  url: string
}): Promise<{ documents: Array<{ id: string; name: string; status: string }> }> {
  return verxioFetch('/api/tavus/documents', { body: JSON.stringify(input), method: 'POST' })
}

export function saveTavusMeeting(input: {
  allowlist?: string[]
  username: string
}): Promise<{ email: string; username: string }> {
  return verxioFetch('/api/tavus/meetings', { body: JSON.stringify(input), method: 'PUT' })
}

export function publishTavusShare(input: { password?: string; requireAuth?: boolean }): Promise<{ url: string }> {
  return verxioFetch('/api/tavus/share', { body: JSON.stringify(input), method: 'POST' })
}

export function createTavusVideo(script: string): Promise<{ hostedUrl: string; status: string; videoId: string }> {
  return verxioFetch('/api/tavus/videos', { body: JSON.stringify({ script }), method: 'POST' })
}

export function saveTavusPronunciation(
  rules: Array<{ pronunciation: string; word: string }>
): Promise<{ rules: unknown[] }> {
  return verxioFetch('/api/tavus/pronunciation', { body: JSON.stringify({ rules }), method: 'PUT' })
}

export function uploadTavusFile(fileName: string, data: string, mime: string): Promise<{ url: string }> {
  return verxioFetch('/api/tavus/uploads', { body: JSON.stringify({ data, fileName, mime }), method: 'POST' })
}

export function trainTavusFace(input: {
  consent: boolean
  imageUrl?: string
  name?: string
  videoUrl?: string
  voiceId?: string
}): Promise<{ faceId: string; status: string }> {
  return verxioFetch('/api/tavus/faces', { body: JSON.stringify(input), method: 'POST' })
}

export function trainTavusVoice(input: {
  audioUrl: string
  consent: boolean
  name?: string
}): Promise<{ status: string; voiceId: string }> {
  return verxioFetch('/api/tavus/voices', { body: JSON.stringify(input), method: 'POST' })
}
