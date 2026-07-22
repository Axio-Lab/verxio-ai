import { type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { getGlobalModelInfo, setGlobalModel } from '@/hermes'
import { useI18n } from '@/i18n'
import {
  resolveHostedDefaultModel,
  resolveStatusbarModel,
  shouldClearStaleStatusbarModel,
  shouldShowByokStatusbarModel
} from '@/lib/hosted-default-model'
import {
  getInferenceCatalog,
  getInferenceSettings,
  verxioApiEnabled,
  type VerxioInferenceCatalogResponse
} from '@/lib/verxio-api'
import { getScopedModelOptions } from '@/lib/verxio-model-options'
import { notifyError } from '@/store/notifications'
import { $currentModel, $currentProvider, setCurrentModel, setCurrentProvider } from '@/store/session'
import type { ModelOptionsResponse } from '@/types/hermes'

async function loadInferenceModeAndHostedDefault(): Promise<{
  catalog: Pick<VerxioInferenceCatalogResponse, 'models'> | null
  hostedDefault: Awaited<ReturnType<typeof resolveHostedDefaultModel>>
  mode: 'byok' | 'hosted' | null
}> {
  if (!verxioApiEnabled()) {
    return { catalog: null, hostedDefault: null, mode: null }
  }

  try {
    const [settings, catalog] = await Promise.all([getInferenceSettings(), getInferenceCatalog()])

    return {
      catalog,
      hostedDefault: resolveHostedDefaultModel(settings, catalog),
      mode: settings.mode
    }
  } catch {
    return { catalog: null, hostedDefault: null, mode: null }
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
    try {
      const [result, options] = await Promise.all([getGlobalModelInfo(), getScopedModelOptions()])
      const hermesModel = typeof result.model === 'string' ? result.model.trim() : ''
      const hermesProvider = typeof result.provider === 'string' ? result.provider.trim() : ''
      const { catalog, hostedDefault, mode } = await loadInferenceModeAndHostedDefault()

      // BYOK: never show Verxio Hosted defaults. Empty / leftover Qwen·Gemini → "no model".
      if (mode === 'byok') {
        if (!shouldShowByokStatusbarModel(hermesModel, hermesProvider, options, catalog)) {
          clearStatusbarModel()

          return
        }

        applyModelSelection({ model: hermesModel, provider: hermesProvider })

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
        const { hostedDefault, mode } = await loadInferenceModeAndHostedDefault()

        if (mode === 'byok') {
          clearStatusbarModel()

          return
        }

        if (hostedDefault) {
          applyModelSelection(hostedDefault)
        }
      }
    }
  }, [])

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
          await requestGateway('slash.exec', {
            session_id: activeSessionId,
            command: `/model ${selection.model} --provider ${selection.provider}${selection.persistGlobal ? ' --global' : ''}`
          })

          if (selection.persistGlobal) {
            void refreshCurrentModel()
          }

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
