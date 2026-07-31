import type { QueryClient } from '@tanstack/react-query'

import { readVerxioAuthScope } from '@/lib/auth-scope'
import type { ModelOptionsResponse } from '@/types/hermes'

// Bump when the runtime provider eligibility contract changes so an old
// inventory cannot keep unsupported providers visible after deployment.
const MODEL_OPTIONS_CACHE_KEY = 'verxio.model-options.cache.v4'

/** While true, model-options loaders should pass refresh=1 to Hermes. */
let forceRefreshActive = false

function cacheKey(scope: string): string {
  return `${MODEL_OPTIONS_CACHE_KEY}:${readVerxioAuthScope()}:${scope}`
}

export function readCachedModelOptions(scope: string): ModelOptionsResponse | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    const raw = window.localStorage.getItem(cacheKey(scope))

    if (!raw) {
      return undefined
    }

    const parsed = JSON.parse(raw) as ModelOptionsResponse

    return Array.isArray(parsed.providers) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function writeCachedModelOptions(scope: string, options: ModelOptionsResponse): void {
  if (typeof window === 'undefined' || !Array.isArray(options.providers)) {
    return
  }

  // Never persist an empty catalog — a hung Hermes /api/model/options used to
  // write {providers:[]} and leave the picker on "No models found" after reload
  // even when Verxio Hosted Gemini/Qwen was still configured.
  if (options.providers.length === 0) {
    return
  }

  try {
    window.localStorage.setItem(cacheKey(scope), JSON.stringify(options))
  } catch {
    // Cache writes are best effort; live runtime data still drives the picker.
  }
}

export function clearCachedModelOptions(): void {
  if (typeof window === 'undefined') {
    return
  }

  const prefix = `${MODEL_OPTIONS_CACHE_KEY}:${readVerxioAuthScope()}:`

  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)

      if (key?.startsWith(prefix)) {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    // Cache clears are best effort.
  }
}

export function markModelOptionsForceRefresh(): void {
  forceRefreshActive = true
}

/** True while a connect/disconnect hard-refresh is in flight (safe for parallel queries). */
export function shouldForceModelOptionsRefresh(): boolean {
  return forceRefreshActive
}

/** @deprecated Prefer shouldForceModelOptionsRefresh — kept for call sites mid-migration. */
export function consumeModelOptionsForceRefresh(): boolean {
  return forceRefreshActive
}

/** Immediately clear statusbar/picker lists (e.g. after disconnect). */
export function clearModelOptionsQueries(queryClient: QueryClient): void {
  clearCachedModelOptions()
  queryClient.setQueriesData<ModelOptionsResponse>({ queryKey: ['model-options'] }, { providers: [] })
}

/**
 * Bust localStorage + React Query and refetch every model-options query.
 *
 * Uses type:'all' so Settings-driven connect/disconnect still updates the
 * statusbar even when the model menu dropdown is closed (inactive).
 */
export async function refreshModelOptionsQueries(queryClient: QueryClient): Promise<void> {
  clearCachedModelOptions()
  forceRefreshActive = true

  try {
    await queryClient.invalidateQueries({ queryKey: ['model-options'] })
    await queryClient.refetchQueries({ queryKey: ['model-options'], type: 'all' })
  } finally {
    forceRefreshActive = false
  }
}
