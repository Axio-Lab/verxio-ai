export const VERXIO_AUTH_SCOPE_KEY = 'verxio.auth.scope.v1'

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
}
