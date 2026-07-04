import type { EnvVarInfo } from '@/types/hermes'

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function envCategory(info?: EnvVarInfo): string {
  return typeof info?.category === 'string' ? info.category.trim() : ''
}

/** Credential-shaped env var names (matches Hermes dashboard discovery). */
export function looksLikeToolCredentialEnv(name: string): boolean {
  const trimmed = name.trim()

  if (!ENV_NAME_RE.test(trimmed)) {
    return false
  }

  const upper = trimmed.toUpperCase()

  if (upper.endsWith('_BASE_URL') || upper.endsWith('_URL') || upper.endsWith('_HOST') || upper.endsWith('_PORT')) {
    return false
  }

  return (
    upper.endsWith('_API_KEY') ||
    upper.endsWith('_TOKEN') ||
    upper.endsWith('_SECRET') ||
    upper.endsWith('_PASSWORD') ||
    upper.endsWith('_KEY')
  )
}

export function shouldReloadToolCredential(key: string, info?: EnvVarInfo): boolean {
  if (info?.custom) {
    return true
  }

  const cat = envCategory(info)

  return cat === 'tool' || cat === 'skill'
}
