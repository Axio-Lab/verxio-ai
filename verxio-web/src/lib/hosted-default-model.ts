import type { VerxioInferenceCatalogResponse, VerxioInferenceSettings } from '@/lib/verxio-api'

export interface HostedDefaultModelSelection {
  model: string
  provider: string
}

/** Pick the upstream Hermes model/provider for the user's hosted Verxio default. */
export function resolveHostedDefaultModel(
  settings: Pick<VerxioInferenceSettings, 'defaultModelId' | 'mode'>,
  catalog: Pick<VerxioInferenceCatalogResponse, 'defaultModelId' | 'models'>
): HostedDefaultModelSelection | null {
  if (settings.mode !== 'hosted') {
    return null
  }

  const selected =
    catalog.models.find(model => model.id === settings.defaultModelId) ??
    catalog.models.find(model => model.id === catalog.defaultModelId) ??
    catalog.models.find(model => model.default)

  if (!selected?.upstreamModelId) {
    return null
  }

  return {
    model: selected.upstreamModelId,
    provider: selected.providerSlug || ''
  }
}

/** Decide what the statusbar should show after a Hermes /api/model/info read. */
export function resolveStatusbarModel(
  hermes: { model?: string | null; provider?: string | null },
  currentModel: string,
  hostedDefault: HostedDefaultModelSelection | null
): HostedDefaultModelSelection | null {
  const model = typeof hermes.model === 'string' ? hermes.model.trim() : ''
  const provider = typeof hermes.provider === 'string' ? hermes.provider.trim() : ''

  if (model) {
    return { model, provider }
  }

  if (currentModel.trim()) {
    return null
  }

  return hostedDefault
}
