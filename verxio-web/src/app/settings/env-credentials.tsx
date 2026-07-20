import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { deleteEnvVar, getEnvVars, getGlobalModelInfo, revealEnvVar, setEnvVar } from '@/hermes'
import { useI18n } from '@/i18n'
import { isSelectableModel } from '@/lib/hosted-default-model'
import { type IconComponent } from '@/lib/icons'
import { clearCachedModelOptions, refreshModelOptionsQueries } from '@/lib/model-options-cache'
import { looksLikeToolCredentialEnv, shouldReloadToolCredential } from '@/lib/tool-credentials'
import { getScopedModelOptions } from '@/lib/verxio-model-options'
import { notify, notifyError } from '@/store/notifications'
import { setCurrentModel, setCurrentProvider } from '@/store/session'
import { runRuntimeEnvReload } from '@/store/system-actions'
import type { EnvVarInfo } from '@/types/hermes'

import { asText, includesQuery, redactedValue, withoutKey } from './helpers'
import { Pill } from './primitives'
import type { EnvRowProps } from './types'

// Shared filter used by every credential surface (Providers + Keys pages):
// category gate first, then a free-text match across key name + description.
export function filterEnv(info: EnvVarInfo, key: string, q: string, cat: string, extra?: string): boolean {
  if (asText(info.category) !== cat) {
    return false
  }

  if (!q) {
    return true
  }

  return (
    key.toLowerCase().includes(q) ||
    includesQuery(info.description, q) ||
    Boolean(extra && extra.toLowerCase().includes(q))
  )
}

export function SettingsCategoryHeading({ count, icon: Icon, title }: CategoryHeadingProps) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[length:var(--conversation-text-font-size)] font-medium">
      <Icon className="size-4 text-muted-foreground" />
      <span>{title}</span>
      {count && <Pill>{count}</Pill>}
    </div>
  )
}

// Owns the env-var fetch + the edit/reveal/save/delete lifecycle so multiple
// credential pages (Providers, Keys) share one source of truth and one set of
// mutation handlers instead of duplicating the plumbing.
export function useEnvCredentials(): UseEnvCredentials {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const credentials = t.settings.credentials
  const toolsets = t.settings.toolsets
  const [vars, setVars] = useState<Record<string, EnvVarInfo> | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [pendingClearKey, setPendingClearKey] = useState<string | null>(null)

  // Best-effort cleanup of a retired localStorage flag (global "Show
  // advanced" toggle) — everything in these views is configuration-level.
  useEffect(() => {
    try {
      window.localStorage.removeItem('desktop.settings.keys.show_advanced')
    } catch {
      // Ignore — old key cleanup is best-effort.
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const next = await getEnvVars()

        if (!cancelled) {
          setVars(next)
        }
      } catch (err) {
        notifyError(err, t.settings.keys.failedLoad)
      }
    })()

    return () => void (cancelled = true)
  }, [t.settings.keys.failedLoad])

  function patchVar(key: string, patch: Partial<Pick<EnvVarInfo, 'is_set' | 'redacted_value'>>) {
    setVars(c => (c ? { ...c, [key]: { ...c[key], ...patch } } : c))
  }

  function clearLocalState(key: string) {
    setEdits(c => withoutKey(c, key))
    setRevealed(c => withoutKey(c, key))
  }

  async function syncStatusbarAfterCredentialChange() {
    clearCachedModelOptions()
    await refreshModelOptionsQueries(queryClient)

    try {
      const [info, options] = await Promise.all([getGlobalModelInfo(), getScopedModelOptions()])
      const model = typeof info.model === 'string' ? info.model : ''
      const provider = typeof info.provider === 'string' ? info.provider : ''

      if (!isSelectableModel(model, provider, options)) {
        setCurrentModel('')
        setCurrentProvider('')
      }
    } catch {
      // Best-effort — the next model refresh still corrects the statusbar.
    }
  }

  async function reloadIfToolCredential(key: string) {
    const info = vars?.[key]

    if (!shouldReloadToolCredential(key, info) && !looksLikeToolCredentialEnv(key)) {
      return
    }

    await runRuntimeEnvReload({ notifySuccess: false })
    await syncStatusbarAfterCredentialChange()
  }

  async function handleSave(key: string) {
    const value = edits[key]

    if (!value) {
      return
    }

    setSaving(key)

    try {
      await setEnvVar(key, value)
      patchVar(key, { is_set: true, redacted_value: redactedValue(value) })
      clearLocalState(key)
      await reloadIfToolCredential(key)
      notify({ kind: 'success', title: toolsets.savedTitle, message: toolsets.savedMessage(key) })
    } catch (err) {
      notifyError(err, toolsets.failedSave(key))
    } finally {
      setSaving(null)
    }
  }

  // Direct save for a known value (no edit-state round-trip) — used by the
  // onboarding-style key form, which owns its own input. Returns a result so
  // the form can surface inline errors instead of only toasting.
  async function saveValue(key: string, value: string): Promise<{ message?: string; ok: boolean }> {
    const trimmed = value.trim()

    if (!trimmed) {
      return { message: credentials.enterValueFirst, ok: false }
    }

    setSaving(key)

    try {
      await setEnvVar(key, trimmed)
      setVars(c =>
        c
          ? {
              ...c,
              [key]: c[key] ?? {
                advanced: false,
                category: 'tool',
                custom: true,
                description: credentials.customToolDescription,
                is_password: true,
                is_set: true,
                redacted_value: redactedValue(trimmed),
                tools: [],
                url: null
              }
            }
          : c
      )
      patchVar(key, { is_set: true, redacted_value: redactedValue(trimmed) })
      clearLocalState(key)
      await reloadIfToolCredential(key)
      notify({ kind: 'success', message: toolsets.savedMessage(key), title: toolsets.savedTitle })

      return { ok: true }
    } catch (err) {
      notifyError(err, toolsets.failedSave(key))

      return { message: err instanceof Error ? err.message : credentials.couldNotSave, ok: false }
    } finally {
      setSaving(null)
    }
  }

  async function clearKey(key: string) {
    const removeRow = Boolean(vars?.[key]?.custom)

    setSaving(key)

    try {
      await deleteEnvVar(key)

      if (removeRow) {
        setVars(c => (c ? withoutKey(c, key) : c))
      } else {
        patchVar(key, { is_set: false, redacted_value: null })
      }

      clearLocalState(key)
      await reloadIfToolCredential(key)
      // Provider API-key deletes must drop a stale statusbar model even when the
      // key is not a tool credential (no runtime reload path above).
      await syncStatusbarAfterCredentialChange()
      notify({ kind: 'success', title: toolsets.removedTitle, message: toolsets.removedMessage(key) })
    } catch (err) {
      notifyError(err, toolsets.failedRemove(key))
    } finally {
      setSaving(null)
    }
  }

  function handleClear(key: string) {
    setPendingClearKey(key)
  }

  async function handleReveal(key: string) {
    if (revealed[key]) {
      setRevealed(c => withoutKey(c, key))

      return
    }

    try {
      const result = await revealEnvVar(key)
      setRevealed(c => ({ ...c, [key]: result.value }))
    } catch (err) {
      notifyError(err, toolsets.failedReveal(key))
    }
  }

  return {
    confirmDialog: (
      <ConfirmDialog
        busyLabel={t.settings.credentials.removing}
        confirmLabel={t.common.remove}
        destructive
        onClose={() => setPendingClearKey(null)}
        onConfirm={async () => {
          if (pendingClearKey) {
            await clearKey(pendingClearKey)
          }
        }}
        open={Boolean(pendingClearKey)}
        title={pendingClearKey ? toolsets.removeConfirm(pendingClearKey) : toolsets.removeConfirm('')}
      />
    ),
    saveValue,
    vars,
    rowProps: {
      edits,
      revealed,
      saving,
      setEdits,
      onSave: handleSave,
      onClear: handleClear,
      onReveal: handleReveal
    }
  }
}

interface CategoryHeadingProps {
  count?: string
  icon: IconComponent
  title: string
}

interface UseEnvCredentials {
  confirmDialog: ReactNode
  rowProps: Omit<EnvRowProps, 'varKey' | 'info'>
  saveValue: (key: string, value: string) => Promise<{ message?: string; ok: boolean }>
  vars: Record<string, EnvVarInfo> | null
}
