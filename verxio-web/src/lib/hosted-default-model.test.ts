import { describe, expect, it } from 'vitest'

import { resolveHostedDefaultModel, resolveStatusbarModel } from './hosted-default-model'

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
    }
  ]
}

describe('resolveHostedDefaultModel', () => {
  it('maps the hosted Verxio default to its upstream Hermes model', () => {
    expect(resolveHostedDefaultModel({ defaultModelId: 'verxio-qwen', mode: 'hosted' }, catalog)).toEqual({
      model: 'qwen3.6-plus',
      provider: 'alibaba'
    })
  })

  it('ignores BYOK mode', () => {
    expect(resolveHostedDefaultModel({ defaultModelId: 'verxio-qwen', mode: 'byok' }, catalog)).toBeNull()
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

  it('falls back to the hosted default when nothing is selected yet', () => {
    expect(
      resolveStatusbarModel({ model: '', provider: '' }, '', {
        model: 'qwen3.6-plus',
        provider: 'alibaba'
      })
    ).toEqual({ model: 'qwen3.6-plus', provider: 'alibaba' })
  })
})
