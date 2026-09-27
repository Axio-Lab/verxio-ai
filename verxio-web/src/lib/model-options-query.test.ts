import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelOptionsResponse } from '@/types/hermes'

import { clearCachedModelOptions, readCachedModelOptions } from './model-options-cache'
import {
  modelOptionsQueryKey,
  modelOptionsQueryOptions,
  needsModelOptionsRefetch,
  warmModelOptions
} from './model-options-query'

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: vi.fn()
}))

vi.mock('./verxio-model-options', () => ({
  getScopedModelOptions: vi.fn()
}))

const { getGlobalModelOptions } = await import('@/hermes')
const { getScopedModelOptions } = await import('./verxio-model-options')

const catalog: ModelOptionsResponse = {
  model: 'gpt-x',
  provider: 'openai',
  providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-x', name: 'GPT X' }] }] as never
}

describe('model options query', () => {
  beforeEach(() => {
    clearCachedModelOptions()
    vi.mocked(getScopedModelOptions).mockReset()
    vi.mocked(getGlobalModelOptions).mockReset()
  })

  it('uses one cache key per scope so the statusbar menu, picker and visibility dialog share data', () => {
    expect(modelOptionsQueryKey(null)).toEqual(['model-options', 'global'])
    expect(modelOptionsQueryKey(undefined)).toEqual(['model-options', 'global'])
    expect(modelOptionsQueryKey('sess-1')).toEqual(['model-options', 'sess-1'])
  })

  it('keeps polling while the catalog is empty or hosted-only, and stops once complete', () => {
    expect(needsModelOptionsRefetch(undefined)).toBe(true)
    expect(needsModelOptionsRefetch({ providers: [] })).toBe(true)
    expect(needsModelOptionsRefetch({ ...catalog, partial: true })).toBe(true)
    expect(needsModelOptionsRefetch(catalog)).toBe(false)

    const queryClient = new QueryClient()
    const options = modelOptionsQueryOptions({ queryClient, sessionId: null })
    expect(options.refetchInterval({ state: { data: { providers: [] } } })).toBeGreaterThan(0)
    expect(options.refetchInterval({ state: { data: catalog } })).toBe(false)
  })

  it('writes late runtime results straight into the open query and the localStorage seed', async () => {
    const queryClient = new QueryClient()
    vi.mocked(getScopedModelOptions).mockImplementation(async (_load, hooks) => {
      const hosted: ModelOptionsResponse = { ...catalog, partial: true }
      // Simulate Hermes answering after the hosted budget.
      setTimeout(() => hooks?.onLateRuntimeOptions?.(catalog), 0)

      return hosted
    })

    await warmModelOptions({ queryClient, sessionId: null })
    expect(queryClient.getQueryData<ModelOptionsResponse>(modelOptionsQueryKey(null))?.partial).toBe(true)

    await new Promise(resolve => setTimeout(resolve, 5))
    expect(queryClient.getQueryData<ModelOptionsResponse>(modelOptionsQueryKey(null))?.partial).toBeUndefined()
    expect(readCachedModelOptions('global')?.providers).toHaveLength(1)
  })

  it('routes session-scoped requests through the gateway and global ones through the dashboard', async () => {
    const queryClient = new QueryClient()
    const gateway = { request: vi.fn().mockResolvedValue(catalog) }
    vi.mocked(getScopedModelOptions).mockImplementation(async load => load())

    await warmModelOptions({ gateway: gateway as never, queryClient, sessionId: 'sess-1' })
    expect(gateway.request).toHaveBeenCalledWith('model.options', expect.objectContaining({ session_id: 'sess-1' }))

    vi.mocked(getGlobalModelOptions).mockResolvedValue(catalog)
    await warmModelOptions({ gateway: gateway as never, queryClient, sessionId: null })
    expect(getGlobalModelOptions).toHaveBeenCalled()
  })
})
