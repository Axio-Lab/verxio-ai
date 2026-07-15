import type { QueryClient } from '@tanstack/react-query'

import { readVerxioAuthScope } from '@/lib/auth-scope'
import type { ModelOptionsResponse } from '@/types/hermes'

const MODEL_OPTIONS_CACHE_KEY = 'verxio.model-options.cache.v2'

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

export async function refreshModelOptionsQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['model-options'] })
  await queryClient.refetchQueries({ queryKey: ['model-options'], type: 'active' })
}
