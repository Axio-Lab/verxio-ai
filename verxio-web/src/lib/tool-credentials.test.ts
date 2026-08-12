import { describe, expect, it } from 'vitest'

import { looksLikeToolCredentialEnv, normalizeToolEnvKey, shouldReloadToolCredential } from './tool-credentials'

describe('tool-credentials', () => {
  it('accepts credential-shaped env names', () => {
    expect(looksLikeToolCredentialEnv('MY_VENDOR_API_KEY')).toBe(true)
    expect(looksLikeToolCredentialEnv('FAL_KEY')).toBe(true)
    expect(looksLikeToolCredentialEnv('GEMINI_API_KEY')).toBe(true)
    expect(looksLikeToolCredentialEnv('DASHSCOPE')).toBe(true)
  })

  it('rejects non-credential names', () => {
    expect(looksLikeToolCredentialEnv('GEMINI_BASE_URL')).toBe(false)
    expect(looksLikeToolCredentialEnv('not valid')).toBe(false)
  })

  it('normalizes DashScope pretty aliases to DASHSCOPE_API_KEY', () => {
    expect(normalizeToolEnvKey('DASHSCOPE')).toBe('DASHSCOPE_API_KEY')
    expect(normalizeToolEnvKey('dashscope_key')).toBe('DASHSCOPE_API_KEY')
    expect(normalizeToolEnvKey('DASHSCOPE_API_KEY')).toBe('DASHSCOPE_API_KEY')
  })

  it('reloads tool, skill, custom, and media provider credentials', () => {
    expect(shouldReloadToolCredential('FAL_KEY', { category: 'tool' } as never)).toBe(true)
    expect(shouldReloadToolCredential('NOTION_API_KEY', { category: 'skill' } as never)).toBe(true)
    expect(shouldReloadToolCredential('X', { custom: true } as never)).toBe(true)
    expect(shouldReloadToolCredential('DASHSCOPE_API_KEY', { category: 'provider' } as never)).toBe(true)
    expect(shouldReloadToolCredential('DASHSCOPE', { category: 'provider' } as never)).toBe(true)
    expect(shouldReloadToolCredential('OPENAI_API_KEY', { category: 'provider' } as never)).toBe(false)
  })
})
