import { getGlobalModelOptions, setModelAssignment } from '@/hermes'
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

function selectedHostedModelIds(model: VerxioInferenceModel): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []

  for (const modelId of [model.upstreamModelId, ...(model.availableModelIds ?? [])]) {
    if (modelId && !seen.has(modelId)) {
      seen.add(modelId)
      ordered.push(modelId)
    }
  }

  return ordered
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

  const hostedModelIds = selected ? selectedHostedModelIds(selected) : []

  if (!selected?.upstreamModelId || hostedModelIds.length === 0) {
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
        capabilities: Object.fromEntries(hostedModelIds.map(model => [model, capabilitiesFor(selected)])),
        is_current: true,
        is_verxio_hosted: true,
        models: hostedModelIds,
        name: selected.displayName,
        pricing: Object.fromEntries(hostedModelIds.map(model => [model, pricingFor(selected)])),
        slug: selected.providerSlug,
        total_models: hostedModelIds.length,
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

function firstConfiguredRuntimeModel(options: ModelOptionsResponse): { model: string; provider: string } | null {
  const provider = configuredRuntimeProviders(options)[0]
  const model = provider?.models?.[0]

  if (!provider?.slug || !model) {
    return null
  }

  return {
    model: String(model),
    provider: String(provider.slug)
  }
}

export async function ensureByokDefaultModel(options: ModelOptionsResponse): Promise<ModelOptionsResponse> {
  const currentModel = String(options.model || '').trim()
  const currentProvider = String(options.provider || '').trim()

  if (currentModel && currentProvider) {
    return options
  }

  const fallback = firstConfiguredRuntimeModel(options)

  if (!fallback) {
    return options
  }

  try {
    await setModelAssignment({
      model: fallback.model,
      provider: fallback.provider,
      scope: 'main'
    })
  } catch {
    // The picker/statusbar can still use this session-safe default. Persistence
    // will retry the next time the user explicitly selects a model.
  }

  return {
    ...options,
    model: fallback.model,
    provider: fallback.provider
  }
}

/** Pin Verxio-hosted, then linked/authenticated providers, above the rest. */
export function prioritizeLinkedProviders(
  options: ModelOptionsResponse,
  opts: { dropHosted?: boolean; authenticatedOnly?: boolean } = {}
): ModelOptionsResponse {
  const dropHosted = opts.dropHosted === true
  // BYOK / post-disconnect: never keep skeleton rows that still advertise models.
  const authenticatedOnly = opts.authenticatedOnly === true || dropHosted
  const currentProvider = (options.provider || '').trim()

  const providers = (options.providers ?? [])
    .filter(provider => !dropHosted || !provider.is_verxio_hosted)
    .filter(provider => !authenticatedOnly || provider.authenticated !== false)
    .filter(provider => (provider.models ?? []).length > 0)
    .slice()
    .sort((a, b) => {
      const hostedA = !!a.is_verxio_hosted
      const hostedB = !!b.is_verxio_hosted

      if (hostedA !== hostedB) {
        return hostedA ? -1 : 1
      }

      const authA = a.authenticated !== false
      const authB = b.authenticated !== false

      if (authA !== authB) {
        return authA ? -1 : 1
      }

      if (authA && authB) {
        const currentA = a.slug === currentProvider || !!a.is_current
        const currentB = b.slug === currentProvider || !!b.is_current

        if (currentA !== currentB) {
          return currentA ? -1 : 1
        }
      }

      return (a.name || a.slug).localeCompare(b.name || b.slug)
    })

  return {
    ...options,
    providers
  }
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
    // Keep the runtime/session selection when present. Forcing hosted.model here
    // made every picker refresh show the hosted default (flash lite) as current
    // even after the user switched to another hosted Gemini/Qwen model.
    model: String(runtime.model || '').trim() || hosted.model,
    provider: String(runtime.provider || '').trim() || hosted.provider,
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
        return prioritizeLinkedProviders(mergeHostedAndRuntimeModelOptions(hosted, await runtimeOptionsPromise))
      } catch {
        return prioritizeLinkedProviders(hosted)
      }
    }

    // BYOK: only linked Hermes providers; never keep a stale Verxio-hosted row.
    return ensureByokDefaultModel(prioritizeLinkedProviders(await runtimeOptionsPromise, { dropHosted: true }))
  } catch {
    // If the Verxio control-plane call hiccups, keep the model picker usable.
  }

  return ensureByokDefaultModel(prioritizeLinkedProviders(await runtimeOptionsPromise, { dropHosted: true }))
}
