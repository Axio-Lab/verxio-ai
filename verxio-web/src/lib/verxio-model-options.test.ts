import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setModelAssignment } from '@/hermes'
import type { ModelOptionsResponse } from '@/types/hermes'

import type * as verxioApiModule from './verxio-api'
import type { VerxioInferenceCatalogResponse, VerxioInferenceSettings } from './verxio-api'
import {
  ensureByokDefaultModel,
  getScopedModelOptions,
  hostedModelOptionsFromInference,
  mergeHostedAndRuntimeModelOptions,
  prioritizeLinkedProviders
} from './verxio-model-options'

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: vi.fn(),
  setModelAssignment: vi.fn()
}))

vi.mock('./verxio-api', async importOriginal => {
  const actual = (await importOriginal()) as typeof verxioApiModule

  return {
    ...actual,
    getInferenceCatalog: vi.fn(),
    getInferenceSettings: vi.fn(),
    verxioApiEnabled: vi.fn(() => true)
  }
})

const mockedSetModelAssignment = vi.mocked(setModelAssignment)

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

beforeEach(() => {
  mockedSetModelAssignment.mockReset()
})

describe('hostedModelOptionsFromInference', () => {
  it('does not offer Verxio-hosted families', () => {
    const settings: VerxioInferenceSettings = {
      defaultModelId: 'verxio-qwen',
      mode: 'hosted',
      monthlyCreditUsd: 0,
      overageEnabled: false,
      spendingLimitUsd: null
    }

    expect(hostedModelOptionsFromInference(settings, catalog)).toEqual({ providers: [] })
    expect(
      hostedModelOptionsFromInference(
        {
          defaultModelId: 'verxio-gemini',
          mode: 'byok',
          monthlyCreditUsd: 0,
          overageEnabled: false,
          spendingLimitUsd: null
        },
        catalog
      )
    ).toEqual({ providers: [] })
  })
})

describe('mergeHostedAndRuntimeModelOptions', () => {
  it('keeps the runtime selection when present and appends configured runtime providers', () => {
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

    expect(result.provider).toBe('openai')
    expect(result.model).toBe('gpt-5-mini')
    expect(result.providers?.map(provider => provider.slug)).toEqual(['openai'])
    expect(result.providers?.flatMap(provider => provider.models ?? [])).toEqual(['gpt-5-mini'])
    expect(result.providers?.some(provider => provider.is_verxio_hosted)).toBe(false)
  })

  it('does not fall back to a Verxio-hosted model when runtime has no selection', () => {
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
          models: ['gpt-5-mini'],
          name: 'OpenAI',
          slug: 'openai'
        }
      ]
    })

    expect(result.provider).toBeUndefined()
    expect(result.model).toBeUndefined()
    expect(result.providers?.map(provider => provider.slug)).toEqual(['openai'])
  })

  it('keeps the user provider models when they overlap a former hosted catalog', () => {
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
    expect(result.providers?.find(provider => provider.slug === 'alibaba')?.is_verxio_hosted).toBeUndefined()
  })

  it('keeps connected providers and does not label them as Verxio hosted', () => {
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
    expect(result.providers?.find(provider => provider.slug === 'gemini')).toMatchObject({
      models: ['gemini-flash-lite-latest', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview'],
      name: 'Google AI Studio'
    })
    expect(result.providers?.find(provider => provider.slug === 'gemini')?.is_verxio_hosted).toBeUndefined()
    expect(result.providers?.find(provider => provider.slug === 'groq')).toMatchObject({
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

    expect(result.providers?.map(provider => provider.slug)).toEqual(['openai', 'anthropic-oauth'])
    expect(result.providers?.some(provider => provider.is_verxio_hosted)).toBe(false)
    expect(result.providers?.some(provider => provider.authenticated === false)).toBe(false)
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

describe('getScopedModelOptions', () => {
  it('returns the user runtime catalog and no Verxio-hosted rows', async () => {
    const { getInferenceCatalog, getInferenceSettings } = await import('./verxio-api')
    vi.mocked(getInferenceSettings).mockResolvedValue({
      defaultModelId: '',
      mode: 'byok',
      monthlyCreditUsd: 0,
      overageEnabled: false,
      spendingLimitUsd: null
    })
    vi.mocked(getInferenceCatalog).mockResolvedValue({ defaultModelId: '', models: [] })

    const result = await getScopedModelOptions(async () => ({
      model: 'gpt-5-mini',
      provider: 'openai',
      providers: [
        {
          authenticated: true,
          models: ['gpt-5-mini'],
          name: 'OpenAI',
          slug: 'openai'
        }
      ]
    }))

    expect(result.model).toBe('gpt-5-mini')
    expect(result.provider).toBe('openai')
    expect(result.providers?.some(provider => provider.is_verxio_hosted)).toBe(false)
    expect(result.providers?.map(provider => provider.slug)).toEqual(['openai'])
  })

  it('does not invent hosted models when the runtime catalog rejects', async () => {
    const { getInferenceCatalog, getInferenceSettings } = await import('./verxio-api')
    vi.mocked(getInferenceSettings).mockResolvedValue({
      defaultModelId: '',
      mode: 'byok',
      monthlyCreditUsd: 0,
      overageEnabled: false,
      spendingLimitUsd: null
    })
    vi.mocked(getInferenceCatalog).mockResolvedValue(catalog)

    await expect(getScopedModelOptions(() => Promise.reject(new Error('backend timed out')))).rejects.toThrow(
      'backend timed out'
    )
  })
})

describe('ensureByokDefaultModel', () => {
  it('persists the first authenticated provider model when BYOK has no selected model', async () => {
    mockedSetModelAssignment.mockResolvedValue({
      gateway_tools: [],
      model_info: null,
      ok: true,
      provider: 'openai-codex',
      model: 'gpt-5.6-sol'
    })

    const result = await ensureByokDefaultModel({
      providers: [
        {
          authenticated: true,
          models: ['gpt-5.6-sol', 'gpt-5-mini'],
          name: 'ChatGPT',
          slug: 'openai-codex'
        }
      ]
    })

    expect(result).toMatchObject({
      model: 'gpt-5.6-sol',
      provider: 'openai-codex'
    })
    expect(mockedSetModelAssignment).toHaveBeenCalledWith({
      model: 'gpt-5.6-sol',
      provider: 'openai-codex',
      scope: 'main'
    })
  })
})
