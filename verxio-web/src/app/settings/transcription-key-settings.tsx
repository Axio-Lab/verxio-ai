import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { getHermesConfigRecord, saveHermesConfig } from '@/hermes'
import { ExternalLink, Mic, Save } from '@/lib/icons'
import {
  CLOUD_TRANSCRIPTION_PROVIDERS,
  type CloudTranscriptionProvider,
  cloudTranscriptionProviderById,
  type CloudTranscriptionProviderId
} from '@/lib/transcription-providers'
import { notify, notifyError } from '@/store/notifications'
import type { EnvVarInfo, HermesConfigRecord } from '@/types/hermes'

import { CONTROL_TEXT } from './constants'
import { CredentialKeyCard } from './credential-key-ui'
import { getNested, setNested } from './helpers'
import { ListRow, LoadingState, SectionHeading } from './primitives'
import type { EnvRowProps } from './types'

const MODEL_CONFIG_PATHS: Partial<Record<CloudTranscriptionProviderId, string>> = {
  elevenlabs: 'stt.elevenlabs.model_id',
  groq: 'stt.groq.model',
  mistral: 'stt.mistral.model',
  openai: 'stt.openai.model'
}

const REALTIME_CONFIG_PATH = 'notepad.realtime_transcription'

function providerFromConfig(config: HermesConfigRecord): CloudTranscriptionProvider {
  const configured = String(getNested(config, 'stt.provider') ?? '')

  return cloudTranscriptionProviderById(configured) ?? CLOUD_TRANSCRIPTION_PROVIDERS[0]
}

function modelFromConfig(config: HermesConfigRecord, provider: CloudTranscriptionProvider): string {
  const path = MODEL_CONFIG_PATHS[provider.id]
  const configured = path ? String(getNested(config, path) ?? '') : ''

  return provider.models.includes(configured) ? configured : provider.recommendedModel
}

function applyTranscriptionConfig(
  config: HermesConfigRecord,
  provider: CloudTranscriptionProvider,
  model: string,
  realtime: boolean
): HermesConfigRecord {
  let next = setNested(config, 'stt.enabled', true)
  next = setNested(next, 'stt.provider', provider.id)

  const path = MODEL_CONFIG_PATHS[provider.id]

  if (path) {
    next = setNested(next, path, model || provider.recommendedModel)
  }

  return setNested(next, REALTIME_CONFIG_PATH, realtime)
}

function transcriptionEnvInfo(provider: CloudTranscriptionProvider, existing?: EnvVarInfo): EnvVarInfo {
  return {
    advanced: false,
    category: 'tool',
    channel_managed: false,
    custom: existing?.custom,
    description: provider.description,
    is_password: true,
    is_set: Boolean(existing?.is_set),
    redacted_value: existing?.redacted_value ?? null,
    tools: ['voice_transcription'],
    url: provider.docsUrl
  }
}

export function TranscriptionKeySettings({
  rowProps,
  vars
}: {
  rowProps: Omit<EnvRowProps, 'info' | 'varKey'>
  vars: Record<string, EnvVarInfo>
}) {
  const [config, setConfig] = useState<HermesConfigRecord | null>(null)

  const [selectedProviderId, setSelectedProviderId] = useState<CloudTranscriptionProviderId>(
    CLOUD_TRANSCRIPTION_PROVIDERS[0].id
  )

  const [selectedModel, setSelectedModel] = useState(CLOUD_TRANSCRIPTION_PROVIDERS[0].recommendedModel)
  const [realtime, setRealtime] = useState(false)
  const [openKey, setOpenKey] = useState<null | string>(null)
  const [savingConfig, setSavingConfig] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const loaded = await getHermesConfigRecord()

        if (cancelled) {
          return
        }

        const provider = providerFromConfig(loaded)
        setConfig(loaded)
        setSelectedProviderId(provider.id)
        setSelectedModel(modelFromConfig(loaded, provider))
        setRealtime(Boolean(getNested(loaded, REALTIME_CONFIG_PATH)))
      } catch (error) {
        notifyError(error, 'Could not load transcription settings')
      }
    })()

    return () => void (cancelled = true)
  }, [])

  const selectedProvider = useMemo(
    () => cloudTranscriptionProviderById(selectedProviderId) ?? CLOUD_TRANSCRIPTION_PROVIDERS[0],
    [selectedProviderId]
  )

  useEffect(() => {
    if (!selectedProvider.models.includes(selectedModel)) {
      setSelectedModel(selectedProvider.recommendedModel)
    }
  }, [selectedModel, selectedProvider])

  const transcriptionRows = useMemo(
    () =>
      CLOUD_TRANSCRIPTION_PROVIDERS.map(provider => ({
        info: transcriptionEnvInfo(provider, vars[provider.envKey]),
        provider
      })),
    [vars]
  )

  async function handleSaveConfig() {
    if (!config) {
      return
    }

    setSavingConfig(true)

    try {
      const next = applyTranscriptionConfig(config, selectedProvider, selectedModel, realtime)
      await saveHermesConfig(next)
      setConfig(next)
      notify({ kind: 'success', message: 'Transcription settings saved' })
    } catch (error) {
      notifyError(error, 'Could not save transcription settings')
    } finally {
      setSavingConfig(false)
    }
  }

  if (!config) {
    return <LoadingState label="Loading transcription settings..." />
  }

  return (
    <div className="grid gap-5">
      <section>
        <SectionHeading icon={Mic} meta={selectedProvider.label} title="Transcription" />
        <p className="mb-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          Choose the cloud speech provider Verxio uses for Notepad recordings. Keys stay in your runtime credentials.
        </p>

        <div className="divide-y divide-(--ui-stroke-secondary)">
          <ListRow
            action={
              <Select
                onValueChange={value => setSelectedProviderId(value as CloudTranscriptionProviderId)}
                value={selectedProvider.id}
              >
                <SelectTrigger className={CONTROL_TEXT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLOUD_TRANSCRIPTION_PROVIDERS.map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            description={selectedProvider.description}
            title="Provider"
          />
          <ListRow
            action={
              <Select onValueChange={setSelectedModel} value={selectedModel}>
                <SelectTrigger className={CONTROL_TEXT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedProvider.models.map(model => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            description="Used for Notepad audio transcription. Groq Turbo is the recommended low-cost default."
            title="Model"
          />
          <ListRow
            action={
              <div className="flex items-center justify-end">
                <Switch checked={realtime} onCheckedChange={setRealtime} />
              </div>
            }
            description="When enabled, Notepad can transcribe audio chunks while recording instead of waiting until the end."
            title="Realtime transcription"
          />
        </div>

        <div className="mt-3 flex justify-end">
          <Button disabled={savingConfig} onClick={handleSaveConfig} size="sm" type="button">
            {savingConfig ? <Mic className="animate-pulse" /> : <Save />}
            {savingConfig ? 'Saving...' : 'Save transcription settings'}
          </Button>
        </div>
      </section>

      <section>
        <SectionHeading icon={Mic} title="Cloud API keys" />
        <div className="grid gap-2">
          {transcriptionRows.map(({ provider, info }) => (
            <CredentialKeyCard
              expanded={openKey === provider.envKey}
              info={info}
              key={provider.envKey}
              label={`${provider.label} transcription`}
              onExpand={() => setOpenKey(provider.envKey)}
              onToggle={() => setOpenKey(current => (current === provider.envKey ? null : provider.envKey))}
              placeholder={`Paste ${provider.label} API key`}
              rowProps={rowProps}
              varKey={provider.envKey}
            />
          ))}
        </div>
        <a
          className="mt-3 inline-flex items-center gap-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary) underline-offset-4 hover:text-foreground hover:underline"
          href={selectedProvider.docsUrl}
          rel="noreferrer"
          target="_blank"
        >
          Get a {selectedProvider.label} API key
          <ExternalLink className="size-3" />
        </a>
      </section>
    </div>
  )
}
