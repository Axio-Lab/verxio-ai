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

export async function verxioFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(verxioApiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {})
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
