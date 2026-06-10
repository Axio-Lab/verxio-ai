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

export interface ComposioApp {
  slug: string
  name: string
  description: string
  logoUrl: string | null
  categories: string[]
  noAuth: boolean
  toolsCount?: number | null
  triggersCount?: number | null
  sampleTools?: ComposioToolPreview[]
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
    throw new Error(detail || `${response.status} ${response.statusText}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
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

export function authSignup(email: string, password: string, displayName?: string): Promise<VerxioAuthResponse> {
  return verxioFetch<VerxioAuthResponse>('/api/auth/signup', {
    body: JSON.stringify({ email, name: displayName || email.split('@')[0] || 'Verxio User', password }),
    method: 'POST'
  })
}

export function authLogout(): Promise<{ ok: boolean }> {
  return verxioFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export function listVerxioArtifacts(): Promise<VerxioArtifactListResponse> {
  return verxioFetch<VerxioArtifactListResponse>('/api/artifacts')
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

export function initiateComposioConnection(appSlug: string): Promise<ComposioInitiateResponse> {
  return verxioFetch<ComposioInitiateResponse>('/api/composio/connections/initiate', {
    body: JSON.stringify({ appSlug }),
    method: 'POST'
  })
}

export function disconnectComposioAccount(accountId: string): Promise<{ message?: string }> {
  return verxioFetch<{ message?: string }>(`/api/composio/connections/${encodeURIComponent(accountId)}`, {
    method: 'DELETE'
  })
}
