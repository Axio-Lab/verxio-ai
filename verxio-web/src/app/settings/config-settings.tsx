import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  getElevenLabsVoices,
  getFishAudioVoices,
  getHermesConfigDefaults,
  getHermesConfigRecord,
  getHermesConfigSchema,
  saveHermesConfig
} from '@/hermes'
import { useI18n } from '@/i18n'
import { FISH_AUDIO_VOICES_CHANGED_EVENT, notifyFishAudioVoicesChanged } from '@/lib/fishaudio-session'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import type { ConfigFieldSchema, HermesConfigRecord } from '@/types/hermes'

import { CONTROL_TEXT, EMPTY_SELECT_VALUE, FIELD_DESCRIPTIONS, FIELD_LABELS, SECTIONS } from './constants'
import { fieldCopyForSchemaKey } from './field-copy'
import { enumOptionsFor, getNested, prettyName, setNested } from './helpers'
import { MemoryConnect } from './memory/connect'
import { ModelSettings } from './model-settings'
import { EmptyState, ListRow, LoadingState, SettingsContent } from './primitives'
import { ProviderConfigPanel } from './provider-config-panel'

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return true
  }

  const message = err instanceof Error ? err.message : String(err)

  return /aborted|aborterror/i.test(message)
}

function ConfigField({
  schemaKey,
  schema,
  value,
  enumOptions,
  optionLabels,
  onChange,
  descriptionExtra
}: {
  schemaKey: string
  schema: ConfigFieldSchema
  value: unknown
  enumOptions?: string[]
  optionLabels?: Record<string, string>
  onChange: (value: unknown) => void
  descriptionExtra?: ReactNode
}) {
  const { t } = useI18n()
  const c = t.settings.config

  const label =
    fieldCopyForSchemaKey(t.settings.fieldLabels, schemaKey) ??
    fieldCopyForSchemaKey(FIELD_LABELS, schemaKey) ??
    prettyName(schemaKey.split('.').pop() ?? schemaKey)

  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '')

  const rawDescription = (
    fieldCopyForSchemaKey(t.settings.fieldDescriptions, schemaKey) ??
    fieldCopyForSchemaKey(FIELD_DESCRIPTIONS, schemaKey) ??
    schema.description ??
    ''
  ).trim()

  const normalizedDesc = normalize(rawDescription)

  const description =
    rawDescription && normalizedDesc !== normalize(label) && normalizedDesc !== normalize(schemaKey)
      ? rawDescription
      : undefined

  const descriptionNode: ReactNode = descriptionExtra ? (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {description}
      {descriptionExtra}
    </span>
  ) : (
    description
  )

  const row = (action: ReactNode, wide = false) => (
    <ListRow action={action} description={descriptionNode} title={label} wide={wide} />
  )

  if (schema.type === 'boolean') {
    return row(
      <div className="flex items-center justify-end">
        <Switch checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    )
  }

  const selectOptions = enumOptions ?? (schema.type === 'select' ? (schema.options ?? []).map(String) : undefined)

  if (selectOptions) {
    return row(
      <Select
        onValueChange={next => onChange(next === EMPTY_SELECT_VALUE ? '' : next)}
        value={String(value ?? '') || EMPTY_SELECT_VALUE}
      >
        <SelectTrigger className={CONTROL_TEXT}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {selectOptions.map(option => (
            <SelectItem key={option || EMPTY_SELECT_VALUE} value={option || EMPTY_SELECT_VALUE}>
              {option
                ? (optionLabels?.[option] ?? prettyName(option))
                : schemaKey === 'display.personality'
                  ? c.none
                  : c.noneParen}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (schema.type === 'number') {
    return row(
      <Input
        className={CONTROL_TEXT}
        onChange={e => {
          const raw = e.target.value
          const n = raw === '' ? 0 : Number(raw)

          if (!Number.isNaN(n)) {
            onChange(n)
          }
        }}
        placeholder={c.notSet}
        type="number"
        value={value === undefined || value === null ? '' : String(value)}
      />
    )
  }

  if (schema.type === 'list') {
    return row(
      <Input
        className={CONTROL_TEXT}
        onChange={e =>
          onChange(
            e.target.value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          )
        }
        placeholder={c.commaSeparated}
        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
      />
    )
  }

  if (typeof value === 'object' && value !== null) {
    return row(
      <Textarea
        className={cn('min-h-28 resize-y bg-background font-mono', CONTROL_TEXT)}
        onChange={e => {
          try {
            onChange(JSON.parse(e.target.value))
          } catch {
            /* keep last valid */
          }
        }}
        placeholder={c.notSet}
        spellCheck={false}
        value={JSON.stringify(value, null, 2)}
      />,
      true
    )
  }

  const isLong = schema.type === 'text' || String(value ?? '').length > 100

  return row(
    isLong ? (
      <Textarea
        className={cn('min-h-24 resize-y bg-background', CONTROL_TEXT)}
        onChange={e => onChange(e.target.value)}
        placeholder={c.notSet}
        value={String(value ?? '')}
      />
    ) : (
      <Input
        className={CONTROL_TEXT}
        onChange={e => onChange(e.target.value)}
        placeholder={c.notSet}
        value={String(value ?? '')}
      />
    ),
    isLong
  )
}

export function ConfigSettings({
  activeSectionId,
  onConfigSaved,
  importInputRef
}: {
  activeSectionId: string
  onConfigSaved?: () => void
  importInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const { t } = useI18n()
  const c = t.settings.config
  const [config, setConfig] = useState<HermesConfigRecord | null>(null)
  const [_defaults, setDefaults] = useState<HermesConfigRecord | null>(null)
  const [schema, setSchema] = useState<Record<string, ConfigFieldSchema> | null>(null)
  const [elevenLabsVoiceOptions, setElevenLabsVoiceOptions] = useState<string[] | null>(null)
  const [elevenLabsVoiceLabels, setElevenLabsVoiceLabels] = useState<Record<string, string>>({})
  const [fishAudioVoiceOptions, setFishAudioVoiceOptions] = useState<string[] | null>(null)
  const [fishAudioVoiceLabels, setFishAudioVoiceLabels] = useState<Record<string, string>>({})
  const [fishAudioVoicesLoading, setFishAudioVoicesLoading] = useState(false)
  const [fishAudioVoicesVersion, setFishAudioVoicesVersion] = useState(0)
  const fishAudioDefaultChangedRef = useRef(false)
  const saveVersionRef = useRef(0)
  const [saveVersion, setSaveVersion] = useState(0)
  const selectedTtsProvider = config ? getNested(config, 'tts.provider') : null

  useEffect(() => {
    let cancelled = false

    // Paint config+schema first so Workspace/Advanced are usable; defaults can
    // trail without blocking the whole settings panel on a cold gateway.
    void (async () => {
      try {
        const [nextConfig, nextSchema] = await Promise.all([getHermesConfigRecord(), getHermesConfigSchema()])

        if (cancelled) {
          return
        }

        setConfig(nextConfig)
        setSchema(nextSchema.fields)

        const nextDefaults = await getHermesConfigDefaults().catch(() => ({}) as HermesConfigRecord)

        if (!cancelled) {
          setDefaults(nextDefaults)
        }
      } catch (err) {
        if (!cancelled && !isAbortError(err)) {
          notifyError(err, c.failedLoad)
        }
      }
    })()

    return () => void (cancelled = true)
  }, [c.failedLoad])

  useEffect(() => {
    // Voice catalogs are only needed on the Voice/TTS section — skip the
    // network hop when browsing Model / Memory / other config tabs.
    if (activeSectionId !== 'voice' && selectedTtsProvider !== 'elevenlabs') {
      return
    }

    let cancelled = false

    getElevenLabsVoices()
      .then(result => {
        if (cancelled || !result.available) {
          return
        }

        setElevenLabsVoiceOptions(result.voices.map(voice => voice.voice_id))
        setElevenLabsVoiceLabels(Object.fromEntries(result.voices.map(voice => [voice.voice_id, voice.label])))
      })
      .catch(() => {
        if (!cancelled) {
          setElevenLabsVoiceOptions(null)
          setElevenLabsVoiceLabels({})
        }
      })

    return () => void (cancelled = true)
  }, [activeSectionId, selectedTtsProvider])

  useEffect(() => {
    if (selectedTtsProvider !== 'fishaudio') {
      return
    }

    let cancelled = false
    setFishAudioVoicesLoading(true)

    getFishAudioVoices()
      .then(result => {
        if (cancelled) {
          return
        }

        const voices = result.available ? result.voices : []
        setFishAudioVoiceOptions(voices.map(voice => voice.voice_id))
        setFishAudioVoiceLabels(Object.fromEntries(voices.map(voice => [voice.voice_id, voice.label])))
      })
      .catch(() => {
        if (!cancelled) {
          setFishAudioVoiceOptions([])
          setFishAudioVoiceLabels({})
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFishAudioVoicesLoading(false)
        }
      })

    return () => void (cancelled = true)
  }, [fishAudioVoicesVersion, selectedTtsProvider])

  useEffect(() => {
    const refresh = () => setFishAudioVoicesVersion(version => version + 1)
    window.addEventListener(FISH_AUDIO_VOICES_CHANGED_EVENT, refresh)

    return () => window.removeEventListener(FISH_AUDIO_VOICES_CHANGED_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (!config || saveVersion === 0) {
      return
    }

    const v = saveVersion

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await saveHermesConfig(config)

          if (saveVersionRef.current === v) {
            if (fishAudioDefaultChangedRef.current) {
              fishAudioDefaultChangedRef.current = false
              notifyFishAudioVoicesChanged('set_default')
            }

            onConfigSaved?.()
          }
        } catch (err) {
          if (saveVersionRef.current === v) {
            notifyError(err, c.autosaveFailed)
          }
        }
      })()
    }, 550)

    return () => window.clearTimeout(t)
  }, [config, c.autosaveFailed, onConfigSaved, saveVersion])

  const updateConfig = (next: HermesConfigRecord) => {
    saveVersionRef.current += 1
    setConfig(next)
    setSaveVersion(saveVersionRef.current)
  }

  const sectionFields = useMemo(() => {
    if (!schema) {
      return new Map<string, [string, ConfigFieldSchema][]>()
    }

    return new Map(
      SECTIONS.map(s => [s.id, s.keys.flatMap(k => (schema[k] ? [[k, schema[k]] as [string, ConfigFieldSchema]] : []))])
    )
  }, [schema])

  const fields = sectionFields.get(activeSectionId) ?? []

  // Deep-link target from the command palette (?field=<key>): scroll the row
  // into view and flash it, then drop the param so it doesn't re-fire.
  const [searchParams, setSearchParams] = useSearchParams()
  const targetField = searchParams.get('field')

  useEffect(() => {
    if (!targetField || !config || !schema) {
      return
    }

    const element = document.getElementById(`setting-field-${targetField}`)

    if (!element) {
      return
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.classList.add('setting-field-highlight')

    const timeout = window.setTimeout(() => element.classList.remove('setting-field-highlight'), 1600)

    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous)
        next.delete('field')

        return next
      },
      { replace: true }
    )

    return () => window.clearTimeout(timeout)
  }, [config, schema, setSearchParams, targetField])

  function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]

    if (!file) {
      return
    }

    const reader = new FileReader()

    reader.onload = () => {
      try {
        updateConfig(JSON.parse(String(reader.result)))
        notify({ kind: 'success', title: c.imported, message: t.common.saving })
      } catch (err) {
        notifyError(err, c.invalidJson)
      }
    }

    reader.readAsText(file)
    e.target.value = ''
  }

  if (!config || !schema) {
    return <LoadingState label={c.loading} />
  }

  if (activeSectionId === 'voice' && selectedTtsProvider === 'fishaudio' && fishAudioVoicesLoading) {
    return <LoadingState label="Loading Fish Audio voices..." />
  }

  return (
    <SettingsContent>
      {activeSectionId === 'model' && (
        <div className="mb-6">
          <ModelSettings />
        </div>
      )}
      {fields.length === 0 ? (
        <EmptyState description={c.emptyDesc} title={c.emptyTitle} />
      ) : (
        <div className="grid gap-1">
          {fields.map(([key, field]) => (
            <div className="scroll-mt-6 rounded-lg" id={`setting-field-${key}`} key={key}>
              <ConfigField
                descriptionExtra={
                  key === 'memory.provider' && Boolean(getNested(config, key)) ? (
                    <MemoryConnect provider={String(getNested(config, key))} />
                  ) : undefined
                }
                enumOptions={
                  key === 'tts.elevenlabs.voice_id'
                    ? enumOptionsFor(key, getNested(config, key), config, elevenLabsVoiceOptions ?? undefined)
                    : key === 'tts.fishaudio.reference_id'
                      ? enumOptionsFor(key, getNested(config, key), config, fishAudioVoiceOptions ?? undefined)
                      : enumOptionsFor(key, getNested(config, key), config)
                }
                onChange={value => {
                  if (key === 'tts.fishaudio.reference_id') {
                    fishAudioDefaultChangedRef.current = true
                  }

                  updateConfig(setNested(config, key, value))
                }}
                optionLabels={
                  key === 'tts.elevenlabs.voice_id'
                    ? elevenLabsVoiceLabels
                    : key === 'tts.fishaudio.reference_id'
                      ? fishAudioVoiceLabels
                      : undefined
                }
                schema={field}
                schemaKey={key}
                value={getNested(config, key)}
              />
              {key === 'memory.provider' && typeof getNested(config, key) === 'string' && getNested(config, key) ? (
                <ProviderConfigPanel provider={String(getNested(config, key))} />
              ) : null}
            </div>
          ))}
        </div>
      )}
      <input
        accept=".json,application/json"
        className="hidden"
        onChange={handleImport}
        ref={importInputRef}
        type="file"
      />
    </SettingsContent>
  )
}
