import { describe, expect, it } from 'vitest'

import { looksLikeToolCredentialEnv, shouldReloadToolCredential } from './tool-credentials'

describe('tool-credentials', () => {
  it('accepts credential-shaped env names', () => {
    expect(looksLikeToolCredentialEnv('MY_VENDOR_API_KEY')).toBe(true)
    expect(looksLikeToolCredentialEnv('FAL_KEY')).toBe(true)
    expect(looksLikeToolCredentialEnv('GEMINI_API_KEY')).toBe(true)
  })

  it('rejects non-credential names', () => {
    expect(looksLikeToolCredentialEnv('GEMINI_BASE_URL')).toBe(false)
    expect(looksLikeToolCredentialEnv('not valid')).toBe(false)
  })

  it('reloads tool, skill, and custom categories', () => {
    expect(shouldReloadToolCredential('FAL_KEY', { category: 'tool' } as never)).toBe(true)
    expect(shouldReloadToolCredential('NOTION_API_KEY', { category: 'skill' } as never)).toBe(true)
    expect(shouldReloadToolCredential('X', { custom: true } as never)).toBe(true)
    expect(shouldReloadToolCredential('OPENAI_API_KEY', { category: 'provider' } as never)).toBe(false)
  })
})
