import { getGlobalModelOptions } from '@/hermes'
import {
  getInferenceCatalog,
  getInferenceSettings,
  verxioApiEnabled,
  type VerxioInferenceCatalogResponse,
  type VerxioInferenceModel,
  type VerxioInferenceSettings
} from '@/lib/verxio-api'
import type { ModelCapabilities, ModelOptionsResponse, ModelPricing } from '@/types/hermes'

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

  const selectedId = selected.id

  const hostedModels = catalog.models.filter(
    model => model.upstreamModelId && (model.hostedAvailable || model.id === selectedId || model.default)
  )

  return {
    model: selected.upstreamModelId,
    provider: selected.providerSlug,
    providers: hostedModels.map(model => ({
      authenticated: true,
      capabilities: {
        [model.upstreamModelId]: capabilitiesFor(model)
      },
      is_current: model.id === selectedId,
      models: [model.upstreamModelId],
      name: model.displayName,
      pricing: {
        [model.upstreamModelId]: pricingFor(model)
      },
      slug: model.providerSlug,
      total_models: 1,
      warning: model.hostedAvailable ? undefined : `${model.displayName} is not configured for hosted inference.`
    }))
  }
}

export async function getScopedModelOptions(
  loadRuntimeOptions: RuntimeModelOptionsLoader = getGlobalModelOptions
): Promise<ModelOptionsResponse> {
  if (!verxioApiEnabled()) {
    return loadRuntimeOptions()
  }

  try {
    const [settings, catalog] = await Promise.all([getInferenceSettings(), getInferenceCatalog()])
    const hosted = hostedModelOptionsFromInference(settings, catalog)

    if (hosted) {
      return hosted
    }
  } catch {
    // If the Verxio control-plane call hiccups, keep the model picker usable.
  }

  return loadRuntimeOptions()
}
