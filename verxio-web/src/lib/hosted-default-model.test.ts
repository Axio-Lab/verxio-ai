import { describe, expect, it } from 'vitest'

import {
  hermesGatewayModelForHostedSelection,
  isSelectableModel,
  isSelectedHostedFamilyModel,
  isVerxioHostedDefaultSelection,
  resolveHostedDefaultModel,
  resolveHostedStatusbarCorrection,
  resolveStatusbarModel,
  shouldClearStaleStatusbarModel,
  shouldShowByokStatusbarModel
} from './hosted-default-model'

const catalog = {
  defaultModelId: 'verxio-qwen',
  models: [
    {
      byokAvailable: true,
      capabilities: [],
      default: true,
      description: 'Hosted Qwen',
      displayName: 'Verxio Qwen',
      hostedAvailable: true,
      id: 'verxio-qwen',
      availableModelIds: ['qwen3.6-plus', 'qwen3.6-coder'],
      pricing: { currency: 'USD', inputPerMillion: 1, outputPerMillion: 2 },
      providerSlug: 'alibaba',
      requiredEnvVars: [],
      tier: 'standard',
      upstreamModelId: 'qwen3.6-plus'
    },
    {
      byokAvailable: true,
      capabilities: [],
      default: false,
      description: 'Hosted Gemini',
      displayName: 'Verxio Gemini',
      hostedAvailable: true,
      id: 'verxio-gemini',
      availableModelIds: ['gemini-flash-lite-latest'],
      pricing: { currency: 'USD', inputPerMillion: 0.1, outputPerMillion: 0.4 },
      providerSlug: 'gemini',
      requiredEnvVars: [],
      tier: 'fast',
      upstreamModelId: 'gemini-flash-lite-latest'
    }
  ]
}

describe('resolveHostedDefaultModel', () => {
  it('does not pick a Verxio-hosted model', () => {
    expect(resolveHostedDefaultModel({ defaultModelId: 'verxio-qwen', mode: 'hosted' }, catalog)).toBeNull()
    expect(resolveHostedDefaultModel({ defaultModelId: 'verxio-qwen', mode: 'byok' }, catalog)).toBeNull()
  })
})

describe('hermesGatewayModelForHostedSelection', () => {
  it('leaves the user selection unchanged', () => {
    expect(hermesGatewayModelForHostedSelection('qwen3.6-plus', 'alibaba', catalog)).toBeNull()
    expect(hermesGatewayModelForHostedSelection('gemini-flash-lite-latest', 'gemini', catalog)).toBeNull()
    expect(hermesGatewayModelForHostedSelection('verxio-gemini', 'alibaba', catalog)).toBeNull()
    expect(hermesGatewayModelForHostedSelection('gpt-5.4', 'openai-api', catalog)).toBeNull()
  })
})

describe('isSelectableModel', () => {
  it('requires an authenticated provider that lists the model', () => {
    expect(
      isSelectableModel('gpt-5.3-codex', 'openai-codex', {
        providers: [
          { authenticated: false, models: ['gpt-5.3-codex'], name: 'ChatGPT', slug: 'openai-codex' },
          { authenticated: true, models: ['claude-opus-4'], name: 'Claude', slug: 'anthropic' }
        ]
      })
    ).toBe(false)

    expect(
      isSelectableModel('gpt-5.3-codex', 'openai-codex', {
        providers: [{ authenticated: true, models: ['gpt-5.3-codex'], name: 'ChatGPT', slug: 'openai-codex' }]
      })
    ).toBe(true)
  })

  it('never treats Verxio Hosted rows as selectable', () => {
    expect(
      isSelectableModel('qwen3.6-plus', 'alibaba', {
        providers: [
          {
            authenticated: true,
            is_verxio_hosted: true,
            models: ['qwen3.6-plus'],
            name: 'Verxio Qwen',
            slug: 'alibaba'
          }
        ]
      })
    ).toBe(false)
  })
})

describe('shouldClearStaleStatusbarModel', () => {
  it('does not clear while the picker catalog is empty (refresh race)', () => {
    expect(shouldClearStaleStatusbarModel('gpt-5.6-sol', 'openai-codex', { providers: [] })).toBe(false)
    expect(shouldClearStaleStatusbarModel('gpt-5.6-sol', 'openai-codex', { providers: undefined })).toBe(false)
  })

  it('clears only after a loaded catalog proves the model is gone', () => {
    expect(
      shouldClearStaleStatusbarModel('gpt-5.6-sol', 'openai-codex', {
        providers: [{ authenticated: true, models: ['llama-3.3-70b-versatile'], name: 'Groq', slug: 'groq' }]
      })
    ).toBe(true)

    expect(
      shouldClearStaleStatusbarModel('gpt-5.6-sol', 'openai-codex', {
        providers: [{ authenticated: true, models: ['gpt-5.6-sol'], name: 'ChatGPT', slug: 'openai-codex' }]
      })
    ).toBe(false)
  })

  it('keeps Verxio Hosted picker models (does not snap back to flash lite)', () => {
    expect(
      shouldClearStaleStatusbarModel('gemini-3.1-pro-preview', 'gemini', {
        providers: [
          {
            authenticated: true,
            is_verxio_hosted: true,
            models: ['gemini-flash-lite-latest', 'gemini-3.1-pro-preview'],
            name: 'Verxio Gemini',
            slug: 'gemini'
          }
        ]
      })
    ).toBe(false)
  })
})

describe('isVerxioHostedDefaultSelection', () => {
  it('does not treat a user provider model as a Verxio default', () => {
    expect(isVerxioHostedDefaultSelection('qwen3.6-plus', 'alibaba', catalog)).toBe(false)
    expect(isVerxioHostedDefaultSelection('gemini-flash-lite-latest', 'gemini', catalog)).toBe(false)
    expect(isVerxioHostedDefaultSelection('gpt-5.6-sol', 'openai-codex', catalog)).toBe(false)
  })
})

describe('shouldShowByokStatusbarModel', () => {
  it('keeps a user model while options are still empty', () => {
    expect(shouldShowByokStatusbarModel('qwen3.6-plus', 'alibaba', { providers: [] }, catalog)).toBe(true)
    expect(
      shouldShowByokStatusbarModel(
        'qwen3.6-plus',
        'alibaba',
        {
          providers: [
            {
              authenticated: true,
              is_verxio_hosted: true,
              models: ['qwen3.6-plus'],
              name: 'Verxio Qwen',
              slug: 'alibaba'
            }
          ]
        },
        catalog
      )
    ).toBe(false)
  })

  it('keeps ChatGPT/Claude pins while options are still empty', () => {
    expect(shouldShowByokStatusbarModel('gpt-5.6-sol', 'openai-codex', { providers: [] }, catalog)).toBe(true)
    expect(shouldShowByokStatusbarModel('claude-opus-4', 'anthropic', { providers: [] }, catalog)).toBe(true)
  })

  it('requires a selectable BYOK provider once options have loaded', () => {
    expect(
      shouldShowByokStatusbarModel(
        'gpt-5.6-sol',
        'openai-codex',
        {
          providers: [{ authenticated: true, models: ['gpt-5.6-sol'], name: 'ChatGPT', slug: 'openai-codex' }]
        },
        catalog
      )
    ).toBe(true)

    expect(
      shouldShowByokStatusbarModel(
        'gpt-5.6-sol',
        'openai-codex',
        {
          providers: [{ authenticated: true, models: ['grok-3'], name: 'xAI', slug: 'xai' }]
        },
        catalog
      )
    ).toBe(false)
  })
})

describe('resolveStatusbarModel', () => {
  it('prefers a non-empty Hermes model', () => {
    expect(
      resolveStatusbarModel({ model: 'gemini-flash-lite-latest', provider: 'gemini' }, '', {
        model: 'qwen3.6-plus',
        provider: 'alibaba'
      })
    ).toEqual({ model: 'gemini-flash-lite-latest', provider: 'gemini' })
  })

  it('keeps the current model when Hermes returns empty', () => {
    expect(
      resolveStatusbarModel({ model: '', provider: '' }, 'qwen3.6-plus', {
        model: 'gemini-flash-lite-latest',
        provider: 'gemini'
      })
    ).toBeNull()
  })

  it('does not fill a Verxio default when nothing is selected', () => {
    expect(
      resolveStatusbarModel({ model: '', provider: '' }, '', {
        model: 'qwen3.6-plus',
        provider: 'alibaba'
      })
    ).toBeNull()
  })
})

describe('isSelectedHostedFamilyModel', () => {
  it('does not claim a user model for a Verxio hosted family', () => {
    const geminiSettings = { defaultModelId: 'verxio-gemini', mode: 'hosted' as const }

    expect(isSelectedHostedFamilyModel('gemini-flash-lite-latest', 'gemini', geminiSettings, catalog)).toBe(false)
    expect(isSelectedHostedFamilyModel('qwen3.6-plus', 'alibaba', geminiSettings, catalog)).toBe(false)
  })
})

describe('resolveHostedStatusbarCorrection', () => {
  const geminiSettings = { defaultModelId: 'verxio-gemini', mode: 'hosted' as const }
  const qwenSettings = { defaultModelId: 'verxio-qwen', mode: 'hosted' as const }
  const hostedDefault = { model: 'gemini-flash-lite-latest', provider: 'gemini' }
  const qwenDefault = { model: 'qwen3.6-plus', provider: 'alibaba' }

  it('keeps a Gemini pick even when Settings default is Qwen', () => {
    expect(
      resolveHostedStatusbarCorrection(
        { model: 'gemini-flash-lite-latest', provider: 'gemini' },
        { model: 'qwen3.6-plus', provider: 'alibaba' },
        qwenSettings,
        catalog,
        qwenDefault
      )
    ).toBeNull()
  })

  it('keeps a Qwen pick even when Settings default is Gemini', () => {
    expect(
      resolveHostedStatusbarCorrection(
        { model: 'qwen3.6-plus', provider: 'alibaba' },
        { model: 'gemini-flash-lite-latest', provider: 'gemini' },
        geminiSettings,
        catalog,
        hostedDefault
      )
    ).toBeNull()
  })

  it('keeps an in-family Gemini pick', () => {
    expect(
      resolveHostedStatusbarCorrection(
        { model: 'gemini-flash-lite-latest', provider: 'gemini' },
        { model: 'gemini-flash-lite-latest', provider: 'gemini' },
        geminiSettings,
        catalog,
        hostedDefault
      )
    ).toBeNull()
  })

  it('fills from Hermes when the store is empty', () => {
    expect(
      resolveHostedStatusbarCorrection(
        { model: '', provider: '' },
        { model: 'qwen3.6-plus', provider: 'alibaba' },
        geminiSettings,
        catalog,
        hostedDefault
      )
    ).toEqual({ model: 'qwen3.6-plus', provider: 'alibaba' })
  })

  it('does not invent a hosted default when store and Hermes are empty', () => {
    expect(
      resolveHostedStatusbarCorrection(
        { model: '', provider: '' },
        { model: '', provider: '' },
        geminiSettings,
        catalog,
        hostedDefault
      )
    ).toBeNull()
  })
})
