import { useCallback, useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  deleteEnvVar,
  getHermesConfigRecord,
  getToolsetConfig,
  revealEnvVar,
  saveHermesConfig,
  selectToolsetProvider,
  setEnvVar
} from '@/hermes'
import { useI18n } from '@/i18n'
import { Check, Loader2, Save } from '@/lib/icons'
import {
  defaultMediaModel,
  isDashScopeProvider,
  isGoogleImageProvider,
  isMediaToolset,
  isOpenAIImageProvider,
  mediaOptionFields,
  type MediaToolset
} from '@/lib/media-tool-options'
import { mediaToolsetActiveSummary } from '@/lib/media-toolset-summary'
import { configValue, setConfigValue } from '@/lib/transcription-config'

function imageGenProviderId(providerName: string | null | undefined): string | null {
  const name = (providerName || '').trim().toLowerCase()

  if (isDashScopeProvider(providerName)) {
    return 'dashscope'
  }

  if (isGoogleImageProvider(providerName)) {
    return 'google'
  }

  if (name.includes('codex')) {
    return 'openai-codex'
  }

  if (isOpenAIImageProvider(providerName)) {
    return 'openai'
  }

  if (name.includes('fal')) {
    return 'fal'
  }

  if (name.includes('krea')) {
    return 'krea'
  }

  if (name.includes('xai') || name.includes('grok')) {
    return 'xai'
  }

  return null
}

import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { runRuntimeEnvReload } from '@/store/system-actions'
import type { HermesConfigRecord, ToolEnvVar, ToolProvider, ToolsetConfig } from '@/types/hermes'

import { EnvVarActionsMenu, EnvVarActionsTrigger } from './env-var-actions-menu'
import { Pill } from './primitives'

function isNousSubscriptionProvider(provider: ToolProvider): boolean {
  const name = provider.name.trim().toLowerCase()

  return (
    provider.requires_nous_auth ||
    name === 'nous subscription' ||
    name.includes('nous subscription') ||
    (provider.badge || '').toLowerCase() === 'subscription'
  )
}

interface ToolsetConfigPanelProps {
  toolset: string
  /** Called after a key is saved/cleared or a provider chosen, so the parent
   *  can refresh the "Configured / Needs keys" pill. */
  onConfiguredChange?: () => void
}

function providerConfigured(provider: ToolProvider, envState: Record<string, boolean>): boolean {
  if (provider.env_vars.length === 0) {
    return true
  }

  return provider.env_vars.every(ev => envState[ev.key])
}

interface EnvVarFieldProps {
  envVar: ToolEnvVar
  isSet: boolean
  onSaved: (key: string) => void
  onCleared: (key: string) => void
}

function EnvVarField({ envVar, isSet, onSaved, onCleared }: EnvVarFieldProps) {
  const { t } = useI18n()
  const copy = t.settings.toolsets
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  async function handleSave() {
    if (!value) {
      return
    }

    setBusy(true)

    try {
      await setEnvVar(envVar.key, value)
      setEditing(false)
      setValue('')
      onSaved(envVar.key)
      notify({ kind: 'success', title: copy.savedTitle, message: copy.savedMessage(envVar.key) })
      await runRuntimeEnvReload({ notifySuccess: false })
    } catch (err) {
      notifyError(err, copy.failedSave(envVar.key))
    } finally {
      setBusy(false)
    }
  }

  async function clearKey() {
    setBusy(true)

    try {
      await deleteEnvVar(envVar.key)
      setRevealed(null)
      onCleared(envVar.key)
      await runRuntimeEnvReload({ notifySuccess: false })
      notify({ kind: 'success', title: copy.removedTitle, message: copy.removedMessage(envVar.key) })
    } catch (err) {
      notifyError(err, copy.failedRemove(envVar.key))
    } finally {
      setBusy(false)
    }
  }

  function handleClear() {
    setConfirmClearOpen(true)
  }

  async function handleReveal() {
    if (revealed !== null) {
      setRevealed(null)

      return
    }

    try {
      const result = await revealEnvVar(envVar.key)
      setRevealed(result.value)
    } catch (err) {
      notifyError(err, copy.failedReveal(envVar.key))
    }
  }

  return (
    <>
      <div className="grid gap-2 rounded-lg bg-background/55 p-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-medium">{envVar.key}</span>
              <Pill tone={isSet ? 'primary' : 'muted'}>
                {isSet && <Check className="size-3" />}
                {isSet ? copy.set : copy.notSet}
              </Pill>
            </div>
            {envVar.prompt && envVar.prompt !== envVar.key && (
              <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{envVar.prompt}</p>
            )}
          </div>
          {!editing && (
            <EnvVarActionsMenu
              clearDisabled={busy}
              docsUrl={envVar.url}
              isRevealed={revealed !== null}
              isSet={isSet}
              label={envVar.key}
              onClear={handleClear}
              onEdit={() => setEditing(true)}
              onReveal={() => void handleReveal()}
            >
              <EnvVarActionsTrigger label={envVar.key} onClick={event => event.stopPropagation()} />
            </EnvVarActionsMenu>
          )}
        </div>

        {isSet && revealed !== null && (
          <div className="rounded-md bg-background px-2.5 py-1.5 font-mono text-xs text-foreground">
            {revealed || '---'}
          </div>
        )}

        {editing && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              className="min-w-52 flex-1 font-mono"
              onChange={e => setValue(e.target.value)}
              placeholder={envVar.prompt || envVar.key}
              type={envVar.default ? 'text' : 'password'}
              value={value}
            />
            <Button disabled={busy || !value} onClick={() => void handleSave()} size="sm">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save />}
              {t.common.save}
            </Button>
            <Button onClick={() => setEditing(false)} size="sm" variant="text">
              {t.common.cancel}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        busyLabel={t.settings.credentials.removing}
        confirmLabel={t.common.remove}
        destructive
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={clearKey}
        open={confirmClearOpen}
        title={copy.removeConfirm(envVar.key)}
      />
    </>
  )
}

function MediaModelFields({
  toolset,
  providerName,
  isActiveProvider,
  onModelSaved
}: {
  toolset: MediaToolset
  providerName: string | null
  /** Only the active provider may edit/persist model defaults. */
  isActiveProvider: boolean
  onModelSaved?: (config: HermesConfigRecord) => void
}) {
  const { t } = useI18n()
  const copy = t.settings.toolsets
  // Stable identity — a fresh array each render re-fired the load effect and
  // stampeded GET/PUT /api/config (which also raced provider switches).
  const fields = useMemo(() => mediaOptionFields(toolset, providerName), [providerName, toolset])
  const [config, setConfig] = useState<HermesConfigRecord | null>(null)
  const [savingPath, setSavingPath] = useState<string | null>(null)

  useEffect(() => {
    if (!isActiveProvider || fields.length === 0) {
      setConfig(null)

      return
    }

    let cancelled = false

    void getHermesConfigRecord()
      .then(async next => {
        if (cancelled) {
          return
        }

        let seeded = next
        let changed = false

        // Never change image_gen/video_gen provider here — selecting a provider
        // is an explicit user action. Auto-writing the expanded row used to race
        // and overwrite OpenAI with DashScope after a switch.
        if (toolset === 'image_gen') {
          const providerId = imageGenProviderId(providerName)
          const savedProvider = String(configValue(seeded, 'image_gen.provider') ?? '')

          if (providerId && savedProvider === providerId) {
            const modelOptions = fields.find(field => field.path === 'image_gen.model')?.options ?? []
            const currentModel = String(configValue(seeded, 'image_gen.model') ?? '')

            if (!currentModel || (modelOptions.length > 0 && !modelOptions.includes(currentModel))) {
              seeded = setConfigValue(seeded, 'image_gen.model', defaultMediaModel('image_gen', providerName))
              changed = true
            }
          }
        }

        if (toolset === 'video_gen' && isDashScopeProvider(providerName)) {
          if (!configValue(seeded, 'video_gen.model')) {
            seeded = setConfigValue(seeded, 'video_gen.model', defaultMediaModel('video_gen'))
            changed = true
          }
        }

        if (toolset === 'tts' && isDashScopeProvider(providerName)) {
          if (!configValue(seeded, 'tts.dashscope.model')) {
            seeded = setConfigValue(seeded, 'tts.dashscope.model', defaultMediaModel('tts'))
            changed = true
          }

          if (!configValue(seeded, 'tts.dashscope.voice')) {
            seeded = setConfigValue(seeded, 'tts.dashscope.voice', 'Cherry')
            changed = true
          }
        }

        if (changed && !cancelled) {
          try {
            await saveHermesConfig(seeded)
          } catch {
            // Keep the seeded local view even if persistence fails.
          }
        }

        if (!cancelled) {
          setConfig(seeded)
        }
      })
      .catch(err => {
        if (!cancelled) {
          notifyError(err, copy.failedLoad)
        }
      })

    return () => {
      cancelled = true
    }
    // `fields` is memoized on toolset+providerName. Do not depend on unstable
    // parent callbacks — that retriggered a GET /api/config stampede.
  }, [copy.failedLoad, fields, isActiveProvider, providerName, toolset])

  if (!fields.length) {
    return null
  }

  if (!isActiveProvider) {
    return <p className="text-[0.72rem] text-muted-foreground">{copy.usingProviderHint}</p>
  }

  if (!config) {
    return null
  }

  async function saveField(path: string, value: string) {
    setSavingPath(path)

    try {
      let next = setConfigValue(config!, path, value)

      if (toolset === 'tts' && path.startsWith('tts.dashscope.')) {
        next = setConfigValue(next, 'tts.provider', 'dashscope')
      }

      if (toolset === 'image_gen' && path === 'image_gen.model') {
        const providerId = imageGenProviderId(providerName)
        if (providerId) {
          next = setConfigValue(next, 'image_gen.provider', providerId)
        }
      }

      if (toolset === 'video_gen' && path === 'video_gen.model') {
        next = setConfigValue(next, 'video_gen.provider', 'dashscope')
      }

      await saveHermesConfig(next)
      setConfig(next)
      onModelSaved?.(next)
      notify({ kind: 'success', title: copy.modelSavedTitle, message: copy.modelSavedMessage(value) })
    } catch (err) {
      notifyError(err, copy.failedModelSave)
    } finally {
      setSavingPath(null)
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border/50 bg-background/70 p-2.5">
      <p className="text-[0.72rem] font-medium text-foreground">{copy.modelSectionTitle}</p>
      <p className="text-[0.7rem] text-muted-foreground">{copy.modelSectionHint}</p>
      {fields.map(field => {
        const current = String(configValue(config, field.path) ?? '')
        const value = field.options.includes(current) ? current : field.options[0] || ''

        return (
          <label className="grid gap-1" key={field.path}>
            <span className="text-[0.7rem] text-muted-foreground">{field.label}</span>
            <Select
              disabled={savingPath === field.path || field.options.length === 0}
              onValueChange={next => void saveField(field.path, next)}
              value={value}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={field.label} />
              </SelectTrigger>
              <SelectContent>
                {field.options.map(option => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )
      })}
    </div>
  )
}

export function ToolsetConfigPanel({ toolset, onConfiguredChange }: ToolsetConfigPanelProps) {
  const { t } = useI18n()
  const copy = t.settings.toolsets
  const [cfg, setCfg] = useState<ToolsetConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  /** Row currently expanded for viewing keys — not necessarily the active backend. */
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [hermesConfig, setHermesConfig] = useState<HermesConfigRecord | null>(null)
  // Live per-key set/unset state, seeded from the endpoint then patched locally.
  const [envState, setEnvState] = useState<Record<string, boolean>>({})

  const refresh = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!quiet) {
        setLoading(true)
      }

      try {
        const [next, hermes] = await Promise.all([getToolsetConfig(toolset), getHermesConfigRecord().catch(() => null)])
        setCfg(next)
        if (hermes) {
          setHermesConfig(hermes)
        }
        const seeded: Record<string, boolean> = {}

        for (const provider of next.providers) {
          for (const ev of provider.env_vars) {
            seeded[ev.key] = ev.is_set
          }
        }

        setEnvState(seeded)

        const serverActive =
          next.providers.find(p => p.is_active && !isNousSubscriptionProvider(p))?.name ?? next.active_provider ?? null
        if (serverActive) {
          setExpandedProvider(current => current ?? serverActive)
        }
      } catch (err) {
        notifyError(err, copy.failedLoad)
      } finally {
        if (!quiet) {
          setLoading(false)
        }
      }
    },
    [copy.failedLoad, toolset]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const providers = useMemo(
    () => (cfg?.providers ?? []).filter(provider => !isNousSubscriptionProvider(provider)),
    [cfg]
  )

  // Default the expanded row to the active provider, then first configured, else first.
  useEffect(() => {
    if (expandedProvider || providers.length === 0) {
      return
    }

    const selected =
      providers.find(p => p.is_active) ??
      (cfg?.active_provider ? providers.find(p => p.name === cfg.active_provider) : undefined) ??
      providers.find(p => providerConfigured(p, envState)) ??
      providers[0]

    setExpandedProvider(selected.name)
  }, [expandedProvider, providers, envState, cfg])

  const activeSummary = useMemo(() => {
    if (!isMediaToolset(toolset)) {
      const name = cfg?.active_provider ?? providers.find(p => p.is_active)?.name
      return name ? { provider: name, model: null as string | null } : null
    }

    return mediaToolsetActiveSummary(toolset, hermesConfig)
  }, [cfg?.active_provider, hermesConfig, providers, toolset])

  async function handleSelect(provider: ToolProvider) {
    setExpandedProvider(provider.name)
    setSelecting(provider.name)

    try {
      await selectToolsetProvider(toolset, provider.name)

      if (isMediaToolset(toolset)) {
        try {
          // Provider pin is already written by selectToolsetProvider. Only fill
          // missing model defaults — never re-PUT a stale full config that could
          // race another writer and wipe the selection.
          const current = await getHermesConfigRecord()
          let next = current
          let changed = false

          if (toolset === 'image_gen') {
            const providerId = imageGenProviderId(provider.name)
            const savedProvider = String(configValue(current, 'image_gen.provider') ?? '')
            const modelOptions =
              mediaOptionFields(toolset, provider.name).find(field => field.path === 'image_gen.model')?.options ?? []
            const currentModel = String(configValue(current, 'image_gen.model') ?? '')

            if (providerId && savedProvider === providerId) {
              if (!currentModel || (modelOptions.length > 0 && !modelOptions.includes(currentModel))) {
                next = setConfigValue(next, 'image_gen.model', defaultMediaModel('image_gen', provider.name))
                changed = true
              }
            }
          }

          if (toolset === 'video_gen' && isDashScopeProvider(provider.name)) {
            if (!configValue(current, 'video_gen.model')) {
              next = setConfigValue(next, 'video_gen.model', defaultMediaModel('video_gen'))
              changed = true
            }
          }

          if (toolset === 'tts' && isDashScopeProvider(provider.name)) {
            if (!configValue(current, 'tts.dashscope.model')) {
              next = setConfigValue(next, 'tts.dashscope.model', defaultMediaModel('tts'))
              changed = true
            }

            if (!configValue(next, 'tts.dashscope.voice')) {
              next = setConfigValue(next, 'tts.dashscope.voice', 'Cherry')
              changed = true
            }
          }

          if (changed) {
            await saveHermesConfig(next)
            setHermesConfig(next)
          } else {
            setHermesConfig(current)
          }
        } catch {
          // Provider selection already succeeded; model defaults are best-effort.
        }
      }

      notify({ kind: 'success', title: copy.selectedTitle, message: copy.selectedMessage(provider.name) })
      await refresh({ quiet: true })
      onConfiguredChange?.()
    } catch (err) {
      notifyError(err, copy.failedSelect(provider.name))
    } finally {
      setSelecting(null)
    }
  }

  function patchEnv(key: string, isSet: boolean) {
    setEnvState(c => ({ ...c, [key]: isSet }))
    onConfiguredChange?.()
  }

  const emptyMessage = useMemo(() => {
    if (loading || !cfg) {
      return null
    }

    if (!cfg.has_category) {
      return copy.noProviderOptions
    }

    if (providers.length === 0) {
      return copy.noProviders
    }

    return null
  }, [cfg, copy, loading, providers.length])

  if (loading) {
    return <PageLoader className="min-h-32" label={copy.loadingConfig} />
  }

  if (emptyMessage) {
    return <p className="px-1 py-3 text-xs text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <div className="mt-3 grid gap-2">
      {activeSummary && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            {copy.usingProvider(activeSummary.provider, activeSummary.model)}
          </p>
          <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{copy.usingProviderHint}</p>
        </div>
      )}
      {providers.map(provider => {
        const isExpanded = expandedProvider === provider.name
        const isActive = selecting
          ? selecting === provider.name
          : Boolean(provider.is_active) || cfg?.active_provider === provider.name
        const configured = providerConfigured(provider, envState)

        return (
          <div
            className={cn('overflow-hidden rounded-xl bg-background/60', isActive && 'ring-1 ring-primary/35')}
            key={provider.name}
          >
            <button
              aria-expanded={isExpanded}
              className={cn(
                'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-accent/50',
                isActive && 'bg-primary/8'
              )}
              onClick={() => setExpandedProvider(current => (current === provider.name ? null : provider.name))}
              type="button"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{provider.name}</span>
                {provider.badge && <Pill>{provider.badge}</Pill>}
                {isActive && (
                  <Pill tone="primary">
                    <Check className="size-3" />
                    {copy.active}
                  </Pill>
                )}
                {configured && <Pill>{copy.ready}</Pill>}
              </span>
              {selecting === provider.name && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
            </button>

            {isExpanded && (
              <div className="grid gap-2 bg-muted/20 p-3">
                {provider.tag && <p className="text-[0.72rem] text-muted-foreground">{provider.tag}</p>}
                {!isActive && (
                  <Button
                    className="w-fit"
                    disabled={selecting === provider.name}
                    onClick={() => void handleSelect(provider)}
                    size="sm"
                    type="button"
                  >
                    {selecting === provider.name ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {copy.useProvider}
                  </Button>
                )}
                {provider.env_vars.length === 0 ? (
                  <p className="text-[0.72rem] text-muted-foreground">{copy.noApiKeyRequired}</p>
                ) : (
                  provider.env_vars.map(ev => (
                    <EnvVarField
                      envVar={ev}
                      isSet={Boolean(envState[ev.key])}
                      key={ev.key}
                      onCleared={key => patchEnv(key, false)}
                      onSaved={key => patchEnv(key, true)}
                    />
                  ))
                )}
                {isMediaToolset(toolset) && (
                  <MediaModelFields
                    isActiveProvider={isActive}
                    onModelSaved={next => setHermesConfig(next)}
                    providerName={provider.name}
                    toolset={toolset}
                  />
                )}
                {provider.post_setup && (
                  <p className="text-[0.72rem] text-muted-foreground">{copy.postSetup(provider.post_setup)}</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
