import type { EnvVarInfo } from '@/types/hermes'

import { CLOUD_TRANSCRIPTION_ENV_KEYS } from './transcription-providers'

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Provider-catalog keys that also power Tools (image/video). Hosted mode hides
 * Providers → API keys, so these must appear under Tools & Keys → Tools. */
export const MEDIA_PROVIDER_TOOL_ENV_KEYS = ['DASHSCOPE_API_KEY'] as const

/** Pretty Tools labels / custom rows → canonical Hermes env names. */
export const TOOL_ENV_KEY_ALIASES: Record<string, string> = {
  DASHSCOPE: 'DASHSCOPE_API_KEY',
  DASHSCOPE_KEY: 'DASHSCOPE_API_KEY'
}

function envCategory(info?: EnvVarInfo): string {
  return typeof info?.category === 'string' ? info.category.trim() : ''
}

export function normalizeToolEnvKey(name: string): string {
  const upper = name.trim().toUpperCase()

  return TOOL_ENV_KEY_ALIASES[upper] ?? upper
}

/** Credential-shaped env var names (matches runtime dashboard discovery). */
export function looksLikeToolCredentialEnv(name: string): boolean {
  const trimmed = name.trim()

  if (!ENV_NAME_RE.test(trimmed)) {
    return false
  }

  const rawUpper = trimmed.toUpperCase()

  // Accept pretty aliases before canonicalization (e.g. DASHSCOPE → …_API_KEY).
  if (rawUpper in TOOL_ENV_KEY_ALIASES) {
    return true
  }

  const upper = normalizeToolEnvKey(trimmed)

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
  const normalized = normalizeToolEnvKey(key)

  if (CLOUD_TRANSCRIPTION_ENV_KEYS.includes(normalized)) {
    return true
  }

  if ((MEDIA_PROVIDER_TOOL_ENV_KEYS as readonly string[]).includes(normalized)) {
    return true
  }

  if (info?.custom) {
    return true
  }

  const cat = envCategory(info)

  return cat === 'tool' || cat === 'skill'
}
