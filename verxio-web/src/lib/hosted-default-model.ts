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

    if (entry.is_verxio_hosted) {
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

/**
 * Whether the statusbar should drop a Hermes-reported model as stale.
 *
 * Only clear after the picker catalog has loaded with at least one provider.
 * An empty providers list usually means "still loading / cache cleared / BYOK
 * auth not ready yet" — wiping the pill then is what made ChatGPT/BYOK show
 * "no model" after refresh even when config.yaml still had gpt-5.6.
 */
export function shouldClearStaleStatusbarModel(
  model: string,
  provider: string,
  options: Pick<ModelOptionsResponse, 'providers'> | null | undefined
): boolean {
  if (!(options?.providers ?? []).length) {
    return false
  }

  return !isSelectableModel(model, provider, options)
}

/** True when model/provider matches a Verxio Hosted catalog entry (Qwen/Gemini). */
export function isVerxioHostedDefaultSelection(
  model: string,
  provider: string,
  catalog?: Pick<VerxioInferenceCatalogResponse, 'models'> | null
): boolean {
  const targetModel = model.trim()
  const targetProvider = provider.trim().toLowerCase()

  if (!targetModel && !targetProvider) {
    return false
  }

  for (const entry of catalog?.models ?? []) {
    if (!entry.hostedAvailable) {
      continue
    }

    const hostedProvider = String(entry.providerSlug || '')
      .trim()
      .toLowerCase()
    const hostedIds = new Set(
      [entry.upstreamModelId, ...(entry.availableModelIds ?? [])].filter((id): id is string => Boolean(id?.trim()))
    )

    if (targetProvider && hostedProvider && targetProvider === hostedProvider) {
      if (!targetModel || hostedIds.has(targetModel)) {
        return true
      }
    }

    if (targetModel && hostedIds.has(targetModel) && (!targetProvider || targetProvider === hostedProvider)) {
      return true
    }
  }

  return false
}

/**
 * BYOK statusbar rule: never show Verxio Hosted defaults. Only show a model the
 * user can pick from linked BYOK providers. ChatGPT/Claude/xAI survive refresh
 * even while the picker catalog is still empty; leftover Qwen/Gemini do not.
 */
export function shouldShowByokStatusbarModel(
  model: string,
  provider: string,
  options: Pick<ModelOptionsResponse, 'providers'> | null | undefined,
  catalog?: Pick<VerxioInferenceCatalogResponse, 'models'> | null
): boolean {
  const targetModel = model.trim()

  if (!targetModel) {
    return false
  }

  if (isVerxioHostedDefaultSelection(targetModel, provider, catalog)) {
    // Hosted leftovers are never valid in BYOK — even before options load.
    return false
  }

  const providers = options?.providers ?? []

  if (providers.length === 0) {
    // Catalog still warming: keep non-hosted Hermes pins (ChatGPT, Claude, xAI).
    return true
  }

  return isSelectableModel(targetModel, provider, options)
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
