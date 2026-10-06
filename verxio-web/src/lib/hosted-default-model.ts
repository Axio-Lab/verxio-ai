import type { VerxioInferenceCatalogResponse, VerxioInferenceSettings } from '@/lib/verxio-api'
import type { ModelOptionsResponse } from '@/types/hermes'

export interface HostedDefaultModelSelection {
  model: string
  provider: string
}

/** True when the model still appears under an authenticated BYOK picker provider. */
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
 * True when the model appears under any authenticated picker provider,
 * including Verxio Hosted rows. Used for statusbar "stale" detection so a
 * hosted Gemini/Qwen pick is not wiped back to the hosted default.
 */
export function isKnownPickerModel(
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

/**
 * Whether the statusbar should drop a Hermes-reported model as stale.
 *
 * Only clear after the picker catalog has loaded with at least one provider.
 * An empty providers list usually means "still loading / cache cleared / BYOK
 * auth not ready yet" — wiping the pill then is what made ChatGPT/BYOK show
 * "no model" after refresh even when config.yaml still had gpt-5.6.
 *
 * Hosted Verxio models count as known (via {@link isKnownPickerModel}); only
 * truly missing models fall back to the hosted default.
 */
export function shouldClearStaleStatusbarModel(
  model: string,
  provider: string,
  options: Pick<ModelOptionsResponse, 'providers'> | null | undefined
): boolean {
  if (!(options?.providers ?? []).length) {
    return false
  }

  return !isKnownPickerModel(model, provider, options)
}

/** Verxio no longer ships a hosted default, so a user's own model is never one. */
export function isVerxioHostedDefaultSelection(
  model: string,
  provider: string,
  catalog?: Pick<VerxioInferenceCatalogResponse, 'models'> | null
): boolean {
  void model
  void provider
  void catalog

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

/** Verxio does not pick a hosted model. The user connects their own provider. */
export function isSelectedHostedFamilyModel(
  model: string,
  provider: string,
  settings: Pick<VerxioInferenceSettings, 'defaultModelId' | 'mode'>,
  catalog: Pick<VerxioInferenceCatalogResponse, 'defaultModelId' | 'models'>
): boolean {
  void model
  void provider
  void settings
  void catalog

  return false
}

/** Pick the upstream model/provider for the user's hosted Verxio default. */
export function resolveHostedDefaultModel(
  settings: Pick<VerxioInferenceSettings, 'defaultModelId' | 'mode'>,
  catalog: Pick<VerxioInferenceCatalogResponse, 'defaultModelId' | 'models'>
): HostedDefaultModelSelection | null {
  void settings
  void catalog

  return null
}

/** A user's model selection is sent to Hermes as they picked it. */
export function hermesGatewayModelForHostedSelection(
  model: string,
  provider: string,
  catalog: Pick<VerxioInferenceCatalogResponse, 'models'> | null | undefined
): HostedDefaultModelSelection | null {
  void model
  void provider
  void catalog

  return null
}

/**
 * Correct an empty/invalid statusbar pin after refresh.
 *
 * Keep the user's persisted pick when it is any valid Verxio Hosted catalog
 * model (Gemini or Qwen), even if Settings → default is the other family.
 * Only fill from Hermes / the Settings hosted default when the store is empty.
 */
export function resolveHostedStatusbarCorrection(
  store: { model: string; provider: string },
  hermes: { model?: string | null; provider?: string | null },
  settings: Pick<VerxioInferenceSettings, 'defaultModelId' | 'mode'>,
  catalog: Pick<VerxioInferenceCatalogResponse, 'defaultModelId' | 'models'>,
  hostedDefault: HostedDefaultModelSelection | null
): HostedDefaultModelSelection | null {
  void settings
  void catalog
  void hostedDefault

  if (store.model.trim()) {
    return null
  }

  const hermesModel = typeof hermes.model === 'string' ? hermes.model.trim() : ''
  const hermesProvider = typeof hermes.provider === 'string' ? hermes.provider.trim() : ''

  if (hermesModel) {
    return { model: hermesModel, provider: hermesProvider }
  }

  return null
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

  void hostedDefault

  return null
}
