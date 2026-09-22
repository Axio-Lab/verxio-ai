import type { QueryClient } from '@tanstack/react-query'

import type { HermesGateway } from '@/hermes'
import { getGlobalModelOptions } from '@/hermes'
import {
  readCachedModelOptions,
  shouldForceModelOptionsRefresh,
  writeCachedModelOptions
} from '@/lib/model-options-cache'
import { getScopedModelOptions } from '@/lib/verxio-model-options'
import type { ModelOptionsResponse } from '@/types/hermes'

/** Poll cadence while the picker still has nothing (or only hosted rows) to show. */
const EMPTY_OPTIONS_REFETCH_MS = 4_000

export function modelOptionsQueryKey(sessionId: null | string | undefined): readonly ['model-options', string] {
  return ['model-options', sessionId || 'global'] as const
}

interface ModelOptionsQueryInput {
  gateway?: HermesGateway | null
  queryClient: QueryClient
  sessionId: null | string | undefined
}

export function needsModelOptionsRefetch(data: ModelOptionsResponse | undefined): boolean {
  if (!data) {
    return true
  }

  if ((data.providers?.length ?? 0) === 0) {
    return true
  }

  return data.partial === true
}

/**
 * One query definition for every model-options consumer (statusbar menu,
 * picker overlay, visibility dialog, gateway-open prefetch).
 *
 * Hosted rows paint immediately; when Hermes /api/model/options answers after
 * the hosted budget, the merged catalog is written straight into the cache so
 * the open menu fills in without the user closing and reopening it.
 */
export function modelOptionsQueryOptions({ gateway, queryClient, sessionId }: ModelOptionsQueryInput) {
  const scope = sessionId || 'global'
  const queryKey = modelOptionsQueryKey(sessionId)

  const queryFn = async (): Promise<ModelOptionsResponse> => {
    const refresh = shouldForceModelOptionsRefresh()

    const next = await getScopedModelOptions(
      () =>
        gateway && sessionId
          ? gateway.request<ModelOptionsResponse>('model.options', { session_id: sessionId, refresh })
          : getGlobalModelOptions({ refresh }),
      {
        onLateRuntimeOptions: merged => {
          writeCachedModelOptions(scope, merged)
          queryClient.setQueryData<ModelOptionsResponse>(queryKey, merged)
        }
      }
    )

    writeCachedModelOptions(scope, next)

    return next
  }

  return {
    initialData: () => readCachedModelOptions(scope),
    // localStorage seed must not count as fresh under the global 60s staleTime
    initialDataUpdatedAt: 0,
    queryFn,
    queryKey,
    refetchInterval: (query: { state: { data: ModelOptionsResponse | undefined } }) =>
      needsModelOptionsRefetch(query.state.data) ? EMPTY_OPTIONS_REFETCH_MS : false,
    retry: 2,
    staleTime: 0
  }
}

/**
 * Warm the catalog as soon as the gateway is green so the bottom-right model
 * menu opens with models already listed instead of a skeleton.
 */
export function warmModelOptions(input: ModelOptionsQueryInput): Promise<void> {
  const { queryFn, queryKey } = modelOptionsQueryOptions(input)

  return input.queryClient
    .fetchQuery({ queryFn, queryKey, retry: 1, staleTime: 0 })
    .then(() => undefined)
    .catch(() => undefined)
}
