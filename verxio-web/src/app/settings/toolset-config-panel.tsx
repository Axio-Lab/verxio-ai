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
import { configValue, setConfigValue } from '@/lib/transcription-config'

function imageGenProviderId(providerName: string | null | undefined): string | null {
  if (isGoogleImageProvider(providerName)) {
    return 'google'
  }

  if (isOpenAIImageProvider(providerName)) {
    return 'openai'
  }

  if (isDashScopeProvider(providerName)) {
    return 'dashscope'
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

function MediaModelFields({ toolset, providerName }: { toolset: MediaToolset; providerName: string | null }) {
  const { t } = useI18n()
  const copy = t.settings.toolsets
  const fields = mediaOptionFields(toolset, providerName)
  const [config, setConfig] = useState<HermesConfigRecord | null>(null)
  const [savingPath, setSavingPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void getHermesConfigRecord()
      .then(async next => {
        if (cancelled || !fields.length) {
          if (!cancelled) {
            setConfig(next)
          }

          return
        }

        let seeded = next
        let changed = false

        if (toolset === 'image_gen') {
          const providerId = imageGenProviderId(providerName)

          if (providerId && configValue(seeded, 'image_gen.provider') !== providerId) {
            seeded = setConfigValue(seeded, 'image_gen.provider', providerId)
            changed = true
          }

          const modelOptions = fields.find(field => field.path === 'image_gen.model')?.options ?? []
          const currentModel = String(configValue(seeded, 'image_gen.model') ?? '')

          if (!currentModel || (modelOptions.length > 0 && !modelOptions.includes(currentModel))) {
            seeded = setConfigValue(seeded, 'image_gen.model', defaultMediaModel('image_gen', providerName))
            changed = true
          }
        }

        if (toolset === 'video_gen') {
          if (!configValue(seeded, 'video_gen.provider')) {
            seeded = setConfigValue(seeded, 'video_gen.provider', 'dashscope')
            changed = true
          }

          if (!configValue(seeded, 'video_gen.model')) {
            seeded = setConfigValue(seeded, 'video_gen.model', defaultMediaModel('video_gen'))
            changed = true
          }
        }

        if (toolset === 'tts') {
          if (configValue(seeded, 'tts.provider') !== 'dashscope') {
            seeded = setConfigValue(seeded, 'tts.provider', 'dashscope')
            changed = true
          }

          if (!configValue(seeded, 'tts.dashscope.model')) {
            seeded = setConfigValue(seeded, 'tts.dashscope.model', defaultMediaModel('tts'))
            changed = true
          }

          if (!configValue(seeded, 'tts.dashscope.voice')) {
            seeded = setConfigValue(seeded, 'tts.dashscope.voice', 'Cherry')
            changed = true
          }
        }

        if (changed) {
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
      .catch(err => notifyError(err, copy.failedLoad))

    return () => {
      cancelled = true
    }
  }, [copy.failedLoad, fields, providerName, toolset])

  if (!fields.length || !config) {
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
        const providerId = imageGenProviderId(providerName) ?? 'dashscope'
        next = setConfigValue(next, 'image_gen.provider', providerId)
      }

      if (toolset === 'video_gen' && path === 'video_gen.model') {
        next = setConfigValue(next, 'video_gen.provider', 'dashscope')
      }

      await saveHermesConfig(next)
      setConfig(next)
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
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  // Live per-key set/unset state, seeded from the endpoint then patched locally.
  const [envState, setEnvState] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    setLoading(true)

    try {
      const next = await getToolsetConfig(toolset)
      setCfg(next)
      const seeded: Record<string, boolean> = {}

      for (const provider of next.providers) {
        for (const ev of provider.env_vars) {
          seeded[ev.key] = ev.is_set
        }
      }

      setEnvState(seeded)
    } catch (err) {
      notifyError(err, copy.failedLoad)
    } finally {
      setLoading(false)
    }
  }, [copy.failedLoad, toolset])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const providers = useMemo(
    () => (cfg?.providers ?? []).filter(provider => !isNousSubscriptionProvider(provider)),
    [cfg]
  )

  // Default the expanded provider to the one actually active in config
  // (`is_active` / `cfg.active_provider`, mirroring the CLI picker), then the
  // first fully-configured provider, else the first provider. Prefer DashScope
  // for media toolsets so Verxio Qwen Cloud is the obvious default.
  useEffect(() => {
    if (activeProvider || providers.length === 0) {
      return
    }

    const selected =
      providers.find(p => p.is_active && !isNousSubscriptionProvider(p)) ??
      (cfg?.active_provider ? providers.find(p => p.name === cfg.active_provider) : undefined) ??
      (isMediaToolset(toolset) ? providers.find(p => isDashScopeProvider(p.name)) : undefined) ??
      providers.find(p => providerConfigured(p, envState)) ??
      providers[0]

    setActiveProvider(selected.name)
  }, [activeProvider, providers, envState, cfg, toolset])

  async function handleSelect(provider: ToolProvider) {
    setActiveProvider(provider.name)
    setSelecting(provider.name)

    try {
      await selectToolsetProvider(toolset, provider.name)

      if (isMediaToolset(toolset)) {
        try {
          const current = await getHermesConfigRecord()
          let next = current
          let changed = false

          if (toolset === 'image_gen') {
            const providerId = imageGenProviderId(provider.name)

            if (providerId) {
              next = setConfigValue(next, 'image_gen.provider', providerId)
              next = setConfigValue(next, 'image_gen.model', defaultMediaModel('image_gen', provider.name))
              changed = true
            }
          }

          if (toolset === 'video_gen' && isDashScopeProvider(provider.name)) {
            next = setConfigValue(next, 'video_gen.provider', 'dashscope')

            if (!configValue(next, 'video_gen.model')) {
              next = setConfigValue(next, 'video_gen.model', defaultMediaModel('video_gen'))
            }

            changed = true
          }

          if (toolset === 'tts' && isDashScopeProvider(provider.name)) {
            next = setConfigValue(next, 'tts.provider', 'dashscope')

            if (!configValue(next, 'tts.dashscope.model')) {
              next = setConfigValue(next, 'tts.dashscope.model', defaultMediaModel('tts'))
            }

            if (!configValue(next, 'tts.dashscope.voice')) {
              next = setConfigValue(next, 'tts.dashscope.voice', 'Cherry')
            }

            changed = true
          }

          if (changed) {
            await saveHermesConfig(next)
          }
        } catch {
          // Provider selection already succeeded; model defaults are best-effort.
        }
      }

      notify({ kind: 'success', title: copy.selectedTitle, message: copy.selectedMessage(provider.name) })
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
      {providers.map(provider => {
        const isActive = activeProvider === provider.name
        const configured = providerConfigured(provider, envState)

        return (
          <div className="overflow-hidden rounded-xl bg-background/60" key={provider.name}>
            <button
              aria-pressed={isActive}
              className={cn(
                'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-accent/50',
                isActive && 'bg-accent/40'
              )}
              onClick={() => void handleSelect(provider)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{provider.name}</span>
                {provider.badge && <Pill>{provider.badge}</Pill>}
                {configured && (
                  <Pill tone="primary">
                    <Check className="size-3" />
                    {copy.ready}
                  </Pill>
                )}
              </span>
              {selecting === provider.name && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
            </button>

            {isActive && (
              <div className="grid gap-2 bg-muted/20 p-3">
                {provider.tag && <p className="text-[0.72rem] text-muted-foreground">{provider.tag}</p>}
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
                {isMediaToolset(toolset) && <MediaModelFields providerName={provider.name} toolset={toolset} />}
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
