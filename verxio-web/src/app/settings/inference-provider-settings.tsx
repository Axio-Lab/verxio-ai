import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { KeyRound, Loader2, Sparkles } from '@/lib/icons'
import {
  getInferenceCatalog,
  getInferenceUsage,
  updateInferenceSettings,
  verxioApiEnabled,
  type VerxioInferenceCatalogResponse,
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
  onOpenProviderKeys: () => void
}

export function InferenceProviderSettings({ onOpenProviderKeys }: InferenceProviderSettingsProps) {
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

  const hostedModel: VerxioInferenceModel | null = catalog?.models[0] ?? null
  const settings = usage?.settings

  const applyInferenceMode = useCallback(
    async (mode: 'hosted' | 'byok') => {
      setApplying(true)
      setError('')

      try {
        const nextSettings = await updateInferenceSettings({
          defaultModelId: hostedModel?.id ?? catalog?.defaultModelId,
          mode
        })
        const nextUsage = await getInferenceUsage()
        setUsage({ ...nextUsage, settings: nextSettings })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setApplying(false)
      }
    },
    [catalog?.defaultModelId, hostedModel?.id]
  )

  if (!verxioApiEnabled()) {
    return null
  }

  return (
    <section className="mb-5 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <SectionHeading
          icon={Sparkles}
          meta={settings?.mode === 'hosted' ? 'Hosted' : 'BYOK'}
          title="Verxio provider"
        />
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Verxio Hosted runs on Verxio Qwen through DashScope. Connect your own OpenAI, Anthropic, or other provider
        accounts below for frontier models via BYOK.
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
                  aria-pressed={settings?.mode === 'hosted'}
                  disabled={applying}
                  onClick={() => void applyInferenceMode('hosted')}
                  size="sm"
                  type="button"
                  variant={settings?.mode === 'hosted' ? 'default' : 'ghost'}
                >
                  Verxio Hosted
                </Button>
                <Button
                  aria-pressed={settings?.mode === 'byok'}
                  disabled={applying}
                  onClick={() => void applyInferenceMode('byok')}
                  size="sm"
                  type="button"
                  variant={settings?.mode === 'byok' ? 'default' : 'ghost'}
                >
                  BYOK
                </Button>
              </div>
            }
            description="Hosted calls use Verxio Qwen and Verxio billing. BYOK calls use the provider keys you add below."
            title="Billing mode"
          />
          <ListRow
            description={
              hostedModel
                ? `${hostedModel.description} Routes through Hermes provider ${hostedModel.providerSlug}.`
                : 'Verxio Qwen is the Verxio Hosted model for all users and runtimes.'
            }
            title={
              <span className="flex flex-wrap items-baseline gap-2">
                {hostedModel?.displayName ?? 'Verxio Qwen'}
                <Pill tone="primary">Verxio Hosted</Pill>
                {hostedModel && <Pill>{hostedModel.tier}</Pill>}
                {hostedModel && !hostedModel.hostedAvailable ? <Pill>Unavailable</Pill> : null}
              </span>
            }
          />
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
          <ListRow
            action={
              <Button onClick={onOpenProviderKeys} size="sm" type="button" variant="textStrong">
                Open provider keys
              </Button>
            }
            description="Add OpenAI, Anthropic, Gemini, or other provider keys for BYOK. Verxio does not copy those keys into its database."
            title={
              <span className="flex items-center gap-2">
                <KeyRound className="size-3.5" />
                Bring your own key
              </span>
            }
          />
        </div>
      )}
    </section>
  )
}
