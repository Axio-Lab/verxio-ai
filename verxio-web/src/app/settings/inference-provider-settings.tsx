import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { KeyRound, Loader2, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
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

  const hostedModels = catalog?.models ?? []
  const settings = usage?.settings

  const selectedHostedModel = useMemo<VerxioInferenceModel | null>(() => {
    const modelId = settings?.defaultModelId || catalog?.defaultModelId

    return hostedModels.find(model => model.id === modelId) ?? hostedModels[0] ?? null
  }, [catalog?.defaultModelId, hostedModels, settings?.defaultModelId])

  const applyInferenceMode = useCallback(
    async (mode: 'hosted' | 'byok', defaultModelId = settings?.defaultModelId) => {
      setApplying(true)
      setError('')

      try {
        const nextSettings = await updateInferenceSettings({ defaultModelId, mode })
        const nextUsage = await getInferenceUsage()
        setUsage({ ...nextUsage, settings: nextSettings })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setApplying(false)
      }
    },
    [settings?.defaultModelId]
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
        Verxio Hosted uses Verxio-managed provider access and monthly hosted credit. BYOK uses the provider keys in this
        runtime only.
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
            description="Hosted calls use Verxio keys and billing. BYOK calls use the provider keys you add below."
            title="Billing mode"
          />
          <ListRow
            action={
              <Select
                disabled={applying || settings?.mode !== 'hosted'}
                onValueChange={value => void applyInferenceMode('hosted', value)}
                value={selectedHostedModel?.id ?? catalog.defaultModelId}
              >
                <SelectTrigger className={cn('min-w-56', CONTROL_TEXT)}>
                  <SelectValue placeholder="Hosted model" />
                </SelectTrigger>
                <SelectContent>
                  {hostedModels.map(model => (
                    <SelectItem disabled={!model.hostedAvailable} key={model.id} value={model.id}>
                      {model.displayName}
                      {!model.hostedAvailable ? ' · unavailable' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            description={
              selectedHostedModel
                ? `${selectedHostedModel.description} Routes through Hermes provider ${selectedHostedModel.providerSlug}.`
                : 'Verxio GPT is the default hosted model for new users and runtimes.'
            }
            title={
              <span className="flex flex-wrap items-baseline gap-2">
                {selectedHostedModel?.displayName ?? 'Verxio GPT'}
                <Pill tone="primary">Default hosted</Pill>
                {selectedHostedModel && <Pill>{selectedHostedModel.tier}</Pill>}
              </span>
            }
          />
          <ListRow
            action={
              <div className="text-right text-xs">
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
            description="Add OpenAI, Anthropic, Gemini, GLM, Kimi, or DashScope keys for BYOK. Verxio does not copy those keys into its database."
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
