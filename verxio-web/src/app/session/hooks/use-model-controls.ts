import { type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { getGlobalModelInfo, setGlobalModel } from '@/hermes'
import { useI18n } from '@/i18n'
import {
  isVerxioHostedDefaultSelection,
  resolveHostedDefaultModel,
  resolveHostedStatusbarCorrection,
  resolveStatusbarModel,
  shouldClearStaleStatusbarModel
} from '@/lib/hosted-default-model'
import {
  getInferenceCatalog,
  getInferenceSettings,
  verxioApiEnabled,
  type VerxioInferenceCatalogResponse,
  type VerxioInferenceSettings
} from '@/lib/verxio-api'
import { getScopedModelOptions } from '@/lib/verxio-model-options'
import { notifyError } from '@/store/notifications'
import { $currentModel, $currentProvider, setCurrentModel, setCurrentProvider } from '@/store/session'
import type { ModelOptionsResponse } from '@/types/hermes'

async function loadInferenceModeAndHostedDefault(): Promise<{
  catalog: Pick<VerxioInferenceCatalogResponse, 'defaultModelId' | 'models'> | null
  hostedDefault: Awaited<ReturnType<typeof resolveHostedDefaultModel>>
  mode: 'byok' | 'hosted' | null
  settings: VerxioInferenceSettings | null
}> {
  if (!verxioApiEnabled()) {
    return { catalog: null, hostedDefault: null, mode: null, settings: null }
  }

  try {
    const [settings, catalog] = await Promise.all([getInferenceSettings(), getInferenceCatalog()])

    return {
      catalog,
      hostedDefault: resolveHostedDefaultModel(settings, catalog),
      mode: settings.mode,
      settings
    }
  } catch {
    return { catalog: null, hostedDefault: null, mode: null, settings: null }
  }
}

function clearStatusbarModel() {
  setCurrentModel('')
  setCurrentProvider('')
}

function applyModelSelection(selection: { model: string; provider: string }) {
  setCurrentModel(selection.model)

  if (selection.provider) {
    setCurrentProvider(selection.provider)
  }
}

interface ModelSelection {
  model: string
  persistGlobal: boolean
  provider: string
}

interface ModelControlsOptions {
  activeSessionId: string | null
  queryClient: QueryClient
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function useModelControls({ activeSessionId, queryClient, requestGateway }: ModelControlsOptions) {
  const { t } = useI18n()
  const copy = t.desktop

  const updateModelOptionsCache = useCallback(
    (provider: string, model: string, includeGlobal: boolean) => {
      const patch = (prev: ModelOptionsResponse | undefined) => ({ ...(prev ?? {}), provider, model })

      queryClient.setQueryData<ModelOptionsResponse>(['model-options', activeSessionId || 'global'], patch)

      if (includeGlobal) {
        queryClient.setQueryData<ModelOptionsResponse>(['model-options', 'global'], patch)
      }
    },
    [activeSessionId, queryClient]
  )

  const refreshCurrentModel = useCallback(async () => {
    // Live sessions own in-family picks via slash /model + session.info.
    // Always reconcile a leftover from another hosted family (statusbar still
    // saying Qwen while Settings default + picker are Gemini).
    try {
      // Hosted defaults come from the Verxio control plane and must paint even
      // when Hermes /api/model/info is wedged (Docker/dashboard stalls).
      const { catalog, hostedDefault, settings } = await loadInferenceModeAndHostedDefault()
      const storeModel = $currentModel.get().trim()
      const storeProvider = $currentProvider.get().trim()

      if (catalog && settings) {
        const info = await getGlobalModelInfo().catch(() => ({ model: '', provider: '' }))

        const correction = resolveHostedStatusbarCorrection(
          { model: storeModel, provider: storeProvider },
          info,
          settings,
          catalog,
          hostedDefault
        )

        if (correction) {
          applyModelSelection(correction)

          return
        }

        if (hostedDefault && !storeModel) {
          applyModelSelection(hostedDefault)

          return
        }

        // Keep a persisted hosted pick across refresh (any Gemini/Qwen id), even
        // with no live session — do not let Hermes global / Settings default win.
        if (storeModel && isVerxioHostedDefaultSelection(storeModel, storeProvider, catalog)) {
          return
        }

        // Also keep when the provider is a hosted family even if this exact model
        // id is not yet in availableModelIds (catalog still warming / new ids).
        if (
          storeModel &&
          storeProvider &&
          (catalog.models ?? []).some(
            entry =>
              entry.hostedAvailable &&
              String(entry.providerSlug || '')
                .trim()
                .toLowerCase() === storeProvider.toLowerCase()
          )
        ) {
          return
        }

        // Valid pin on a live session — leave it (hosted family or BYOK).
        if (activeSessionId && storeModel) {
          return
        }
      } else if (activeSessionId && storeModel) {
        return
      }

      if (hostedDefault && !$currentModel.get().trim()) {
        applyModelSelection(hostedDefault)
      }

      if (activeSessionId && $currentModel.get().trim()) {
        return
      }

      const optionsPromise = getScopedModelOptions()
      const infoPromise = getGlobalModelInfo().catch(() => ({ model: '', provider: '' }))
      const [result, options] = await Promise.all([infoPromise, optionsPromise])
      const hermesModel = typeof result.model === 'string' ? result.model.trim() : ''
      const hermesProvider = typeof result.provider === 'string' ? result.provider.trim() : ''

      if (activeSessionId && !hermesModel && !$currentModel.get().trim() && hostedDefault) {
        applyModelSelection(hostedDefault)

        return
      }

      if (activeSessionId) {
        return
      }

      const stale = shouldClearStaleStatusbarModel(hermesModel, hermesProvider, options)

      // Stale config after disconnect/key delete: picker loaded and has no match.
      if (hermesModel && stale) {
        if (hostedDefault) {
          applyModelSelection(hostedDefault)

          return
        }

        clearStatusbarModel()

        return
      }

      const next = resolveStatusbarModel(result, $currentModel.get(), hostedDefault)

      if (next) {
        if (shouldClearStaleStatusbarModel(next.model, next.provider, options)) {
          if (hostedDefault) {
            applyModelSelection(hostedDefault)

            return
          }

          clearStatusbarModel()

          return
        }

        applyModelSelection(next)
      }
    } catch {
      // The delayed session.info event still updates this once the agent is ready.
      if (!$currentModel.get()) {
        const { hostedDefault } = await loadInferenceModeAndHostedDefault()

        if (hostedDefault) {
          applyModelSelection(hostedDefault)
        }
      }
    }
  }, [activeSessionId])

  // Returns whether the switch succeeded so callers can await it before
  // applying follow-up changes (e.g. editing a model's reasoning/fast must land
  // on the right active model — bail rather than write to the previous one).
  const selectModel = useCallback(
    async (selection: ModelSelection): Promise<boolean> => {
      const includeGlobal = selection.persistGlobal || !activeSessionId
      // Snapshot for rollback: the switch is applied optimistically, so a
      // failure must restore the prior model/provider (store + query cache)
      // rather than leave the UI showing a model the backend never selected.
      const prevModel = $currentModel.get()
      const prevProvider = $currentProvider.get()

      setCurrentModel(selection.model)
      setCurrentProvider(selection.provider)
      updateModelOptionsCache(selection.provider, selection.model, includeGlobal)

      try {
        if (activeSessionId) {
          // Hermes defaults /model to persist unless --session is explicit.
          const scopeFlag = selection.persistGlobal ? ' --global' : ' --session'
          await requestGateway('slash.exec', {
            session_id: activeSessionId,
            command: `/model ${selection.model} --provider ${selection.provider}${scopeFlag}`
          })

          // Do not refreshCurrentModel while a session is live — session.info
          // and the optimistic store update already own the statusbar.
          void queryClient.invalidateQueries({
            queryKey: selection.persistGlobal ? ['model-options'] : ['model-options', activeSessionId]
          })

          return true
        }

        await setGlobalModel(selection.provider, selection.model)
        void refreshCurrentModel()
        void queryClient.invalidateQueries({ queryKey: ['model-options'] })

        return true
      } catch (err) {
        setCurrentModel(prevModel)
        setCurrentProvider(prevProvider)
        updateModelOptionsCache(prevProvider, prevModel, includeGlobal)
        notifyError(err, copy.modelSwitchFailed)

        return false
      }
    },
    [activeSessionId, copy.modelSwitchFailed, queryClient, refreshCurrentModel, requestGateway, updateModelOptionsCache]
  )

  return { refreshCurrentModel, selectModel, updateModelOptionsCache }
}
