import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Check, KeyRound, Loader2, Sparkles } from '@/lib/icons'
import { clearCachedModelOptions, refreshModelOptionsQueries } from '@/lib/model-options-cache'
import {
  getInferenceCatalog,
  getInferenceUsage,
  updateInferenceSettings,
  verxioApiEnabled,
  type VerxioInferenceCatalogResponse,
  type VerxioInferenceModel,
  type VerxioInferenceUsageResponse
} from '@/lib/verxio-api'

import { ListRow, Pill, SectionHeading } from './primitives'

interface InferenceProviderSettingsProps {
  onInferenceApplied?: () => void
  onOpenProviderKeys: () => void
}

export function InferenceProviderSettings({ onInferenceApplied, onOpenProviderKeys }: InferenceProviderSettingsProps) {
  const queryClient = useQueryClient()
  const [catalog, setCatalog] = useState<VerxioInferenceCatalogResponse | null>(null)
  const [usage, setUsage] = useState<VerxioInferenceUsageResponse | null>(null)
  const [loading, setLoading] = useState(verxioApiEnabled())
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!verxioApiEnabled()) {
      setLoading(false)

      return
    }

    setLoading(true)
    setError('')

    try {
      const [nextCatalog, nextUsage] = await Promise.all([getInferenceCatalog(), getInferenceUsage()])
      setCatalog(nextCatalog)
      setUsage(nextUsage)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const hostedModels: VerxioInferenceModel[] = catalog?.models.filter(model => model.hostedAvailable) ?? []
  const settings = usage?.settings
  const selectedModelId = settings?.defaultModelId ?? catalog?.defaultModelId ?? null

  const applyHostedModel = useCallback(
    async (modelId: string) => {
      if (modelId === selectedModelId) {
        return
      }

      setApplying(true)
      setError('')

      try {
        const nextSettings = await updateInferenceSettings({
          defaultModelId: modelId,
          mode: 'hosted'
        })

        const nextUsage = await getInferenceUsage()
        setUsage({ ...nextUsage, settings: nextSettings })
        clearCachedModelOptions()
        await refreshModelOptionsQueries(queryClient)
        onInferenceApplied?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setApplying(false)
      }
    },
    [onInferenceApplied, queryClient, selectedModelId]
  )

  if (!verxioApiEnabled()) {
    return null
  }

  return (
    <section className="mb-5 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <SectionHeading icon={Sparkles} meta="Hosted + your keys" title="Models" />
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Use Verxio-hosted Qwen or Gemini, or connect your own provider accounts and API keys below. The model selector
        shows both — your pick decides which credentials are used.
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {catalog && usage && (
        <div className="grid gap-1">
          {hostedModels.map(model => {
            const isSelected = model.id === selectedModelId

            return (
              <ListRow
                action={
                  isSelected ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <Check className="size-3.5" />
                      Default
                    </span>
                  ) : (
                    <Button
                      disabled={applying || !model.hostedAvailable}
                      onClick={() => void applyHostedModel(model.id)}
                      size="sm"
                      type="button"
                      variant="textStrong"
                    >
                      Set default
                    </Button>
                  )
                }
                description={model.description}
                key={model.id}
                title={
                  <span className="flex flex-wrap items-baseline gap-2">
                    {model.displayName}
                    <Pill tone="primary">Verxio Hosted</Pill>
                    <Pill>{model.tier}</Pill>
                    {!model.hostedAvailable ? <Pill>Unavailable</Pill> : null}
                  </span>
                }
              />
            )
          })}
          <ListRow
            action={
              <Button onClick={onOpenProviderKeys} size="sm" type="button" variant="textStrong">
                Open provider keys
              </Button>
            }
            description="Connect a provider account below or add keys for OpenAI, Anthropic, Gemini, and other models."
            title={
              <span className="flex items-center gap-2">
                <KeyRound className="size-3.5" />
                Your provider credentials
              </span>
            }
          />
        </div>
      )}
    </section>
  )
}
