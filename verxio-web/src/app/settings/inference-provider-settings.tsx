import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Check, KeyRound, Loader2, Sparkles } from '@/lib/icons'
import {
  getInferenceCatalog,
  getInferenceUsage,
  updateInferenceSettings,
  verxioApiEnabled,
  type VerxioInferenceCatalogResponse,
  type VerxioInferenceMode,
  type VerxioInferenceModel,
  type VerxioInferenceUsageResponse
} from '@/lib/verxio-api'

import { CONTROL_TEXT } from './constants'
import { ListRow, Pill, SectionHeading } from './primitives'

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    currency: 'USD',
    maximumFractionDigits: value >= 10 ? 0 : 2,
    style: 'currency'
  }).format(value)
}

interface InferenceProviderSettingsProps {
  onInferenceModeChange?: (mode: VerxioInferenceMode) => void
  onOpenProviderKeys: () => void
}

export function InferenceProviderSettings({
  onInferenceModeChange,
  onOpenProviderKeys
}: InferenceProviderSettingsProps) {
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
  const mode = settings?.mode ?? 'hosted'
  const isHosted = mode === 'hosted'
  const isByok = mode === 'byok'
  const selectedModelId = settings?.defaultModelId ?? catalog?.defaultModelId ?? null

  const selectedHostedModel =
    hostedModels.find(model => model.id === selectedModelId) ?? hostedModels.find(model => model.default) ?? null

  useEffect(() => {
    if (settings?.mode) {
      onInferenceModeChange?.(settings.mode)
    }
  }, [onInferenceModeChange, settings?.mode])

  const applyInferenceMode = useCallback(
    async (nextMode: VerxioInferenceMode) => {
      setApplying(true)
      setError('')

      try {
        const nextSettings = await updateInferenceSettings({
          defaultModelId:
            nextMode === 'hosted'
              ? (selectedHostedModel?.id ?? catalog?.defaultModelId)
              : (settings?.defaultModelId ?? catalog?.defaultModelId),
          mode: nextMode
        })

        const nextUsage = await getInferenceUsage()
        setUsage({ ...nextUsage, settings: nextSettings })
        onInferenceModeChange?.(nextSettings.mode)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setApplying(false)
      }
    },
    [catalog?.defaultModelId, onInferenceModeChange, selectedHostedModel?.id, settings?.defaultModelId]
  )

  const applyHostedModel = useCallback(
    async (modelId: string) => {
      setApplying(true)
      setError('')

      try {
        const nextSettings = await updateInferenceSettings({
          defaultModelId: modelId,
          mode: 'hosted'
        })

        const nextUsage = await getInferenceUsage()
        setUsage({ ...nextUsage, settings: nextSettings })
        onInferenceModeChange?.(nextSettings.mode)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setApplying(false)
      }
    },
    [onInferenceModeChange]
  )

  if (!verxioApiEnabled()) {
    return null
  }

  return (
    <section className="mb-5 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <SectionHeading icon={Sparkles} meta={isHosted ? 'Hosted' : 'BYOK'} title="Verxio provider" />
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {isHosted
          ? 'Hosted calls use Verxio-managed Qwen or Gemini credentials and Verxio billing. Switch to BYOK to connect your own provider accounts or API keys.'
          : 'BYOK calls use the provider account or API key you choose for the active model. Hosted credit stays available when you switch back to Verxio Hosted.'}
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {catalog && usage && (
        <div className="grid gap-1">
          <ListRow
            action={
              <div className="flex items-center gap-1 rounded-md border border-border/60 p-1">
                <Button
                  aria-pressed={isHosted}
                  disabled={applying}
                  onClick={() => void applyInferenceMode('hosted')}
                  size="sm"
                  type="button"
                  variant={isHosted ? 'default' : 'ghost'}
                >
                  Verxio Hosted
                </Button>
                <Button
                  aria-pressed={isByok}
                  disabled={applying}
                  onClick={() => void applyInferenceMode('byok')}
                  size="sm"
                  type="button"
                  variant={isByok ? 'default' : 'ghost'}
                >
                  BYOK
                </Button>
              </div>
            }
            description="Choose whether model traffic uses Verxio-managed credits or your own provider credentials."
            title="Billing mode"
          />
          {isHosted &&
            hostedModels.map(model => {
              const isSelected = model.id === selectedModelId

              return (
                <ListRow
                  action={
                    isSelected ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <Check className="size-3.5" />
                        Active
                      </span>
                    ) : (
                      <Button
                        disabled={applying || !model.hostedAvailable}
                        onClick={() => void applyHostedModel(model.id)}
                        size="sm"
                        type="button"
                        variant="textStrong"
                      >
                        Use
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
          {isHosted && (
            <ListRow
              action={
                <div className={`text-right text-xs ${CONTROL_TEXT}`}>
                  <div className="font-medium text-foreground">{formatUsd(usage.usage.remainingUsd)} remaining</div>
                  <div className="text-muted-foreground">
                    {formatUsd(usage.usage.usedUsd)} used of {formatUsd(usage.usage.monthlyCreditUsd)}
                  </div>
                </div>
              }
              description="Hosted usage is tracked by Verxio. BYOK calls are paid directly to the provider."
              title="Monthly hosted credit"
            />
          )}
          {isByok && (
            <ListRow
              action={
                <Button onClick={onOpenProviderKeys} size="sm" type="button" variant="textStrong">
                  Open provider keys
                </Button>
              }
              description="Connect a provider account below or add keys for OpenAI, Anthropic, Gemini, and other BYOK models."
              title={
                <span className="flex items-center gap-2">
                  <KeyRound className="size-3.5" />
                  Provider credentials
                </span>
              }
            />
          )}
        </div>
      )}
    </section>
  )
}
