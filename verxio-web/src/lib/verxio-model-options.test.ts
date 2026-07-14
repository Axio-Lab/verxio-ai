import { describe, expect, it } from 'vitest'

import type { VerxioInferenceCatalogResponse, VerxioInferenceSettings } from './verxio-api'
import { hostedModelOptionsFromInference } from './verxio-model-options'

const catalog: VerxioInferenceCatalogResponse = {
  defaultModelId: 'verxio-qwen',
  models: [
    {
      byokAvailable: true,
      capabilities: [
        { key: 'coding', label: 'Coding' },
        { key: 'tools', label: 'Tool use' }
      ],
      default: true,
      description: 'Hosted Qwen',
      displayName: 'Verxio Qwen',
      hostedAvailable: true,
      id: 'verxio-qwen',
      pricing: { currency: 'USD', inputPerMillion: 0.8, outputPerMillion: 2.4 },
      providerSlug: 'alibaba',
      requiredEnvVars: [],
      tier: 'balanced',
      upstreamModelId: 'qwen3.6-plus'
    },
    {
      byokAvailable: true,
      capabilities: [{ key: 'vision', label: 'Vision' }],
      default: false,
      description: 'Hosted Gemini',
      displayName: 'Verxio Gemini',
      hostedAvailable: true,
      id: 'verxio-gemini',
      pricing: { currency: 'USD', inputPerMillion: 0.1, outputPerMillion: 0.4 },
      providerSlug: 'gemini',
      requiredEnvVars: [],
      tier: 'fast',
      upstreamModelId: 'gemini-flash-lite-latest'
    }
  ]
}

describe('hostedModelOptionsFromInference', () => {
  it('returns only Verxio hosted models when hosted mode is active', () => {
    const settings: VerxioInferenceSettings = {
      defaultModelId: 'verxio-qwen',
      mode: 'hosted',
      monthlyCreditUsd: 0,
      overageEnabled: false,
      spendingLimitUsd: null
    }

    const result = hostedModelOptionsFromInference(settings, catalog)

    expect(result?.provider).toBe('alibaba')
    expect(result?.model).toBe('qwen3.6-plus')
    expect(result?.providers?.map(provider => provider.slug)).toEqual(['alibaba', 'gemini'])
    expect(result?.providers?.flatMap(provider => provider.models ?? [])).toEqual([
      'qwen3.6-plus',
      'gemini-flash-lite-latest'
    ])
  })

  it('lets BYOK mode use the runtime model catalog', () => {
    expect(
      hostedModelOptionsFromInference(
        {
          defaultModelId: 'verxio-qwen',
          mode: 'byok',
          monthlyCreditUsd: 0,
          overageEnabled: false,
          spendingLimitUsd: null
        },
        catalog
      )
    ).toBeNull()
  })
})
