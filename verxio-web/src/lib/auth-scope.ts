export const VERXIO_AUTH_SCOPE_KEY = 'verxio.auth.scope.v1'
export const VERXIO_AUTH_CACHE_KEY = 'verxio.auth.me.cache.v1'
const AUTH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function authScopeFromParts(
  workspaceId: string | null | undefined,
  profileId: string | null | undefined
): string {
  const workspace = workspaceId?.trim() || 'workspace'
  const profile = profileId?.trim() || 'profile'

  return `${workspace}:${profile}`
}

export function readVerxioAuthScope(): string {
  if (typeof window === 'undefined') {
    return 'anonymous'
  }

  return window.localStorage.getItem(VERXIO_AUTH_SCOPE_KEY) || 'anonymous'
}

export function writeVerxioAuthScope(scope: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(VERXIO_AUTH_SCOPE_KEY, scope)
}

export function clearVerxioAuthScope(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(VERXIO_AUTH_SCOPE_KEY)
  window.localStorage.removeItem(VERXIO_AUTH_CACHE_KEY)
}

export function readAuthMeCache<T>(): T | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(VERXIO_AUTH_CACHE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as { at?: number; value?: T }

    if (!parsed.at || Date.now() - parsed.at > AUTH_CACHE_TTL_MS || !parsed.value) {
      window.localStorage.removeItem(VERXIO_AUTH_CACHE_KEY)

      return null
    }

    return parsed.value
  } catch {
    return null
  }
}

export function writeAuthMeCache<T>(value: T): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(VERXIO_AUTH_CACHE_KEY, JSON.stringify({ at: Date.now(), value }))
}
