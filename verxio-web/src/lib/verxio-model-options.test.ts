import { describe, expect, it } from 'vitest'

import type { ModelOptionsResponse } from '@/types/hermes'

import type { VerxioInferenceCatalogResponse, VerxioInferenceSettings } from './verxio-api'
import {
  hostedModelOptionsFromInference,
  mergeHostedAndRuntimeModelOptions,
  prioritizeLinkedProviders
} from './verxio-model-options'

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
      availableModelIds: ['qwen3.6-plus', 'qwen3.6-coder'],
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
      availableModelIds: ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-pro'],
      pricing: { currency: 'USD', inputPerMillion: 0.1, outputPerMillion: 0.4 },
      providerSlug: 'gemini',
      requiredEnvVars: [],
      tier: 'fast',
      upstreamModelId: 'gemini-flash-lite-latest'
    }
  ]
}

describe('hostedModelOptionsFromInference', () => {
  it('returns the selected Verxio hosted model group when hosted mode is active', () => {
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
    expect(result?.providers?.map(provider => provider.slug)).toEqual(['alibaba'])
    expect(result?.providers?.every(provider => provider.is_verxio_hosted)).toBe(true)
    expect(result?.providers?.flatMap(provider => provider.models ?? [])).toEqual(['qwen3.6-plus', 'qwen3.6-coder'])
  })

  it('switches the selected Verxio hosted model group', () => {
    const result = hostedModelOptionsFromInference(
      {
        defaultModelId: 'verxio-gemini',
        mode: 'hosted',
        monthlyCreditUsd: 0,
        overageEnabled: false,
        spendingLimitUsd: null
      },
      catalog
    )

    expect(result?.provider).toBe('gemini')
    expect(result?.model).toBe('gemini-flash-lite-latest')
    expect(result?.providers?.map(provider => provider.slug)).toEqual(['gemini'])
    expect(result?.providers?.[0]?.models).toEqual([
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro'
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

describe('mergeHostedAndRuntimeModelOptions', () => {
  it('keeps the hosted default selected while appending configured runtime providers', () => {
    const settings: VerxioInferenceSettings = {
      defaultModelId: 'verxio-qwen',
      mode: 'hosted',
      monthlyCreditUsd: 0,
      overageEnabled: false,
      spendingLimitUsd: null
    }

    const hosted = hostedModelOptionsFromInference(settings, catalog)

    const runtime: ModelOptionsResponse = {
      model: 'gpt-5-mini',
      provider: 'openai',
      providers: [
        {
          authenticated: true,
          models: ['gpt-5-mini'],
          name: 'OpenAI',
          slug: 'openai'
        },
        {
          authenticated: false,
          models: ['claude-sonnet-4'],
          name: 'Anthropic',
          slug: 'anthropic'
        }
      ]
    }

    const result = mergeHostedAndRuntimeModelOptions(hosted!, runtime)

    expect(result.provider).toBe('alibaba')
    expect(result.model).toBe('qwen3.6-plus')
    expect(result.providers?.map(provider => provider.slug)).toEqual(['alibaba', 'openai'])
    expect(result.providers?.flatMap(provider => provider.models ?? [])).toEqual([
      'qwen3.6-plus',
      'qwen3.6-coder',
      'gpt-5-mini'
    ])
  })

  it('dedupes runtime models that already exist in the hosted catalog', () => {
    const settings: VerxioInferenceSettings = {
      defaultModelId: 'verxio-qwen',
      mode: 'hosted',
      monthlyCreditUsd: 0,
      overageEnabled: false,
      spendingLimitUsd: null
    }

    const hosted = hostedModelOptionsFromInference(settings, catalog)

    const result = mergeHostedAndRuntimeModelOptions(hosted!, {
      providers: [
        {
          authenticated: true,
          models: ['qwen3.6-plus', 'qwen3.6-coder'],
          name: 'Alibaba Cloud',
          slug: 'alibaba'
        }
      ]
    })

    expect(result.providers?.find(provider => provider.slug === 'alibaba')?.models).toEqual([
      'qwen3.6-plus',
      'qwen3.6-coder'
    ])
  })

  it('expands the selected hosted provider and keeps connected providers underneath', () => {
    const hosted = hostedModelOptionsFromInference(
      {
        defaultModelId: 'verxio-gemini',
        mode: 'hosted',
        monthlyCreditUsd: 0,
        overageEnabled: false,
        spendingLimitUsd: null
      },
      catalog
    )

    const result = mergeHostedAndRuntimeModelOptions(hosted!, {
      providers: [
        {
          authenticated: true,
          models: ['gemini-flash-lite-latest', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview'],
          name: 'Google AI Studio',
          slug: 'gemini'
        },
        {
          authenticated: true,
          models: ['llama-3.3-70b-versatile'],
          name: 'Groq',
          slug: 'groq'
        }
      ]
    })

    expect(result.providers?.map(provider => provider.slug)).toEqual(['gemini', 'groq'])
    expect(result.providers?.[0]).toMatchObject({
      is_current: true,
      is_verxio_hosted: true,
      models: [
        'gemini-flash-lite-latest',
        'gemini-3.1-flash-lite',
        'gemini-2.5-pro',
        'gemini-3.1-pro-preview',
        'gemini-3-pro-preview'
      ],
      name: 'Verxio Gemini'
    })
    expect(result.providers?.[1]).toMatchObject({
      models: ['llama-3.3-70b-versatile'],
      name: 'Groq'
    })
  })
})

describe('prioritizeLinkedProviders', () => {
  it('pins authenticated providers above unauthenticated ones and drops hosted in BYOK', () => {
    const result = prioritizeLinkedProviders(
      {
        model: 'gpt-5-mini',
        provider: 'openai',
        providers: [
          {
            authenticated: false,
            models: ['claude-sonnet-4'],
            name: 'Anthropic',
            slug: 'anthropic'
          },
          {
            authenticated: true,
            is_verxio_hosted: true,
            models: ['qwen3.6-plus'],
            name: 'Verxio Qwen',
            slug: 'alibaba'
          },
          {
            authenticated: true,
            models: ['gpt-5-mini'],
            name: 'OpenAI',
            slug: 'openai'
          },
          {
            authenticated: true,
            models: ['claude-opus-4'],
            name: 'Claude',
            slug: 'anthropic-oauth'
          }
        ]
      },
      { dropHosted: true }
    )

    expect(result.providers?.map(provider => provider.slug)).toEqual(['openai', 'anthropic-oauth', 'anthropic'])
    expect(result.providers?.some(provider => provider.is_verxio_hosted)).toBe(false)
  })

  it('keeps Verxio-hosted ahead of linked BYOK providers in hosted mode', () => {
    const result = prioritizeLinkedProviders({
      model: 'qwen3.6-plus',
      provider: 'alibaba',
      providers: [
        {
          authenticated: true,
          models: ['gpt-5-mini'],
          name: 'OpenAI',
          slug: 'openai'
        },
        {
          authenticated: true,
          is_current: true,
          is_verxio_hosted: true,
          models: ['qwen3.6-plus'],
          name: 'Verxio Qwen',
          slug: 'alibaba'
        }
      ]
    })

    expect(result.providers?.map(provider => provider.slug)).toEqual(['alibaba', 'openai'])
  })
})
