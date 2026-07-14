import { getGlobalModelOptions } from '@/hermes'
import {
  getInferenceCatalog,
  getInferenceSettings,
  verxioApiEnabled,
  type VerxioInferenceCatalogResponse,
  type VerxioInferenceModel,
  type VerxioInferenceSettings
} from '@/lib/verxio-api'
import type { ModelCapabilities, ModelOptionProvider, ModelOptionsResponse, ModelPricing } from '@/types/hermes'

type RuntimeModelOptionsLoader = () => Promise<ModelOptionsResponse>

function formatUsdPerMillion(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return 'free'
  }

  return `$${value.toFixed(2)}`
}

function pricingFor(model: VerxioInferenceModel): ModelPricing {
  const input = formatUsdPerMillion(model.pricing.inputPerMillion)
  const output = formatUsdPerMillion(model.pricing.outputPerMillion)

  return {
    cache: null,
    free: input === 'free' && output === 'free',
    input,
    output
  }
}

function capabilitiesFor(model: VerxioInferenceModel): ModelCapabilities {
  const keys = new Set(model.capabilities.map(capability => capability.key))

  return {
    fast: keys.has('fast'),
    reasoning: true
  }
}

function selectedHostedModel(
  settings: Pick<VerxioInferenceSettings, 'defaultModelId'>,
  catalog: Pick<VerxioInferenceCatalogResponse, 'defaultModelId' | 'models'>
): VerxioInferenceModel | undefined {
  return (
    catalog.models.find(model => model.id === settings.defaultModelId) ??
    catalog.models.find(model => model.id === catalog.defaultModelId) ??
    catalog.models.find(model => model.default) ??
    catalog.models[0]
  )
}

export function hostedModelOptionsFromInference(
  settings: VerxioInferenceSettings,
  catalog: VerxioInferenceCatalogResponse
): ModelOptionsResponse | null {
  if (settings.mode !== 'hosted') {
    return null
  }

  const selected = selectedHostedModel(settings, catalog)

  if (!selected?.upstreamModelId) {
    return {
      providers: []
    }
  }

  return {
    model: selected.upstreamModelId,
    provider: selected.providerSlug,
    providers: [
      {
        authenticated: true,
        capabilities: {
          [selected.upstreamModelId]: capabilitiesFor(selected)
        },
        is_current: true,
        is_verxio_hosted: true,
        models: [selected.upstreamModelId],
        name: selected.displayName,
        pricing: {
          [selected.upstreamModelId]: pricingFor(selected)
        },
        slug: selected.providerSlug,
        total_models: 1,
        warning: selected.hostedAvailable
          ? undefined
          : `${selected.displayName} is not configured for hosted inference.`
      }
    ]
  }
}

function configuredRuntimeProviders(options: ModelOptionsResponse): ModelOptionProvider[] {
  return (options.providers ?? []).filter(
    provider => provider.authenticated !== false && (provider.models ?? []).length > 0
  )
}

export function mergeHostedAndRuntimeModelOptions(
  hosted: ModelOptionsResponse,
  runtime: ModelOptionsResponse | null | undefined
): ModelOptionsResponse {
  const providers: ModelOptionProvider[] = []
  const providerIndex = new Map<string, number>()
  const seenModels = new Set<string>()

  const appendProvider = (provider: ModelOptionProvider, current = false) => {
    const nextModels = (provider.models ?? []).filter(model => {
      const key = `${provider.slug}:${model}`

      if (seenModels.has(key)) {
        return false
      }

      seenModels.add(key)

      return true
    })

    if (nextModels.length === 0) {
      return
    }

    const existingIndex = providerIndex.get(provider.slug)

    if (existingIndex === undefined) {
      providerIndex.set(provider.slug, providers.length)
      providers.push({
        ...provider,
        is_current: current ? provider.is_current : false,
        models: nextModels,
        total_models: Math.max(provider.total_models ?? 0, nextModels.length)
      })

      return
    }

    const existing = providers[existingIndex]

    providers[existingIndex] = {
      ...existing,
      capabilities: {
        ...(existing.capabilities ?? {}),
        ...(provider.capabilities ?? {})
      },
      is_current: existing.is_current || (current && provider.is_current),
      models: [...(existing.models ?? []), ...nextModels],
      pricing: {
        ...(existing.pricing ?? {}),
        ...(provider.pricing ?? {})
      },
      total_models: Math.max(
        existing.total_models ?? 0,
        provider.total_models ?? 0,
        (existing.models ?? []).length + nextModels.length
      ),
      unavailable_models: Array.from(
        new Set([...(existing.unavailable_models ?? []), ...(provider.unavailable_models ?? [])])
      ),
      warning: existing.warning ?? provider.warning
    }
  }

  for (const provider of hosted.providers ?? []) {
    appendProvider(provider, true)
  }

  for (const provider of configuredRuntimeProviders(runtime ?? {})) {
    appendProvider({ ...provider, is_current: false })
  }

  return {
    ...runtime,
    model: hosted.model,
    provider: hosted.provider,
    providers
  }
}

export async function getScopedModelOptions(
  loadRuntimeOptions: RuntimeModelOptionsLoader = getGlobalModelOptions
): Promise<ModelOptionsResponse> {
  if (!verxioApiEnabled()) {
    return loadRuntimeOptions()
  }

  const runtimeOptionsPromise = loadRuntimeOptions()

  try {
    const [settings, catalog] = await Promise.all([getInferenceSettings(), getInferenceCatalog()])
    const hosted = hostedModelOptionsFromInference(settings, catalog)

    if (hosted) {
      try {
        return mergeHostedAndRuntimeModelOptions(hosted, await runtimeOptionsPromise)
      } catch {
        return hosted
      }
    }
  } catch {
    // If the Verxio control-plane call hiccups, keep the model picker usable.
  }

  return runtimeOptionsPromise
}
