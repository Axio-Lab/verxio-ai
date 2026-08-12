import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Loader2, Plus } from '@/lib/icons'
import { looksLikeToolCredentialEnv, normalizeToolEnvKey } from '@/lib/tool-credentials'
import { cn } from '@/lib/utils'

import { CONTROL_TEXT } from './constants'

interface CustomToolKeyFormProps {
  busy: boolean
  existingKeys: Set<string>
  onSave: (key: string, value: string) => Promise<{ message?: string; ok: boolean }>
}

export function CustomToolKeyForm({ busy, existingKeys, onSave }: CustomToolKeyFormProps) {
  const { t } = useI18n()
  const copy = t.settings.keys.custom
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Map pretty labels like "DASHSCOPE" → DASHSCOPE_API_KEY before save.
  const normalized = normalizeToolEnvKey(name)

  async function handleSubmit() {
    setError('')

    if (!normalized) {
      setError(copy.nameRequired)

      return
    }

    if (!looksLikeToolCredentialEnv(normalized)) {
      setError(copy.invalidName)

      return
    }

    if (existingKeys.has(normalized)) {
      setError(copy.alreadyListed)

      return
    }

    if (!value.trim()) {
      setError(copy.valueRequired)

      return
    }

    setSaving(true)

    try {
      const result = await onSave(normalized, value.trim())

      if (!result.ok) {
        setError(result.message ?? copy.saveFailed)

        return
      }

      setName('')
      setValue('')
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button className="w-full justify-start" onClick={() => setOpen(true)} size="sm" variant="textStrong">
        <Plus className="size-3.5" />
        {copy.addButton}
      </Button>
    )
  }

  return (
    <div className="grid gap-2 rounded-xl border border-dashed border-(--ui-stroke-tertiary) bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{copy.hint}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          autoComplete="off"
          className={cn('font-mono', CONTROL_TEXT)}
          onChange={event => setName(event.target.value)}
          placeholder={copy.namePlaceholder}
          value={name}
        />
        <Input
          autoComplete="off"
          className={cn('font-mono', CONTROL_TEXT)}
          onChange={event => setValue(event.target.value)}
          placeholder={copy.valuePlaceholder}
          type="password"
          value={value}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || saving} onClick={() => void handleSubmit()} size="sm">
          {(busy || saving) && <Loader2 className="size-3.5 animate-spin" />}
          {copy.save}
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            setOpen(false)
            setError('')
            setName('')
            setValue('')
          }}
          size="sm"
          variant="text"
        >
          {t.common.cancel}
        </Button>
      </div>
    </div>
  )
}
