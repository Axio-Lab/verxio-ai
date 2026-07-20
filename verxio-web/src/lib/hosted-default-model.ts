import type { VerxioInferenceCatalogResponse, VerxioInferenceSettings } from '@/lib/verxio-api'
import type { ModelOptionsResponse } from '@/types/hermes'

export interface HostedDefaultModelSelection {
  model: string
  provider: string
}

/** True when the model still appears under an authenticated picker provider. */
export function isSelectableModel(
  model: string,
  provider: string,
  options: Pick<ModelOptionsResponse, 'providers'> | null | undefined
): boolean {
  const targetModel = model.trim()

  if (!targetModel) {
    return false
  }

  const targetProvider = provider.trim().toLowerCase()

  return (options?.providers ?? []).some(entry => {
    if (entry.authenticated === false) {
      return false
    }

    if (!(entry.models ?? []).includes(targetModel)) {
      return false
    }

    if (!targetProvider) {
      return true
    }

    return (
      String(entry.slug || '')
        .trim()
        .toLowerCase() === targetProvider
    )
  })
}

/** Pick the upstream model/provider for the user's hosted Verxio default. */
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

/** Decide what the statusbar should show after a runtime /api/model/info read. */
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
