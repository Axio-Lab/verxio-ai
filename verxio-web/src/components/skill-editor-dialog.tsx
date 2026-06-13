import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createCustomSkill, getSkillContent, updateSkillContent } from '@/hermes'
import { useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'

const CREATE_TEMPLATE = `---
name: my-skill
description: One-line description of when to use this skill.
---

# My Skill

Numbered steps, exact commands, and pitfalls go here.
`

export interface SkillEditorDialogProps {
  open: boolean
  /** Skill name to edit, or null for create mode. */
  editName: string | null
  /** Profile to scope reads/writes to ("" = the active profile). */
  profile?: string
  onClose: () => void
  /** Called after a successful save so the page can refresh its list. */
  onSaved: (name: string) => void
}

export function SkillEditorDialog({ open, editName, profile, onClose, onSaved }: SkillEditorDialogProps) {
  return (
    <Dialog onOpenChange={next => !next && onClose()} open={open}>
      <DialogContent className="max-w-3xl">
        {open && (
          <EditorBody
            editName={editName}
            key={editName ?? '__create__'}
            onClose={onClose}
            onSaved={onSaved}
            profile={profile}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditorBody({ editName, profile, onClose, onSaved }: Omit<SkillEditorDialogProps, 'open'>) {
  const { t } = useI18n()
  const e = t.skills.editor
  const isEdit = editName !== null
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [content, setContent] = useState(isEdit ? '' : CREATE_TEMPLATE)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editName) {
      return
    }

    let cancelled = false

    getSkillContent(editName, profile || undefined)
      .then(res => !cancelled && setContent(res.content))
      .catch(err => !cancelled && setError(String(err)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [editName, profile])

  const handleSave = async () => {
    setError(null)

    if (!isEdit && !name.trim()) {
      setError(e.nameRequired)

      return
    }

    if (!content.trim()) {
      setError(e.contentRequired)

      return
    }

    setSaving(true)

    try {
      if (isEdit) {
        await updateSkillContent(editName, content, profile || undefined)
        onSaved(editName)
      } else {
        const trimmed = name.trim()
        await createCustomSkill(trimmed, content, category.trim() || undefined)
        onSaved(trimmed)
      }

      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? e.editTitle(editName) : e.createTitle}</DialogTitle>
        <DialogDescription>{isEdit ? e.editDesc : e.createDesc}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        {!isEdit && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="skill-editor-name">
                {e.nameLabel}
              </label>
              <Input
                autoFocus
                id="skill-editor-name"
                onChange={event => setName(event.target.value)}
                placeholder="my-skill"
                value={name}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="skill-editor-category">
                {e.categoryLabel}
              </label>
              <Input
                id="skill-editor-category"
                onChange={event => setCategory(event.target.value)}
                placeholder="devops"
                value={category}
              />
            </div>
          </div>
        )}

        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="skill-editor-content">
            {e.contentLabel}
          </label>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : (
            <textarea
              className="min-h-[320px] max-h-[55vh] w-full resize-y rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs leading-relaxed shadow-sm placeholder:text-muted-foreground focus-visible:border-foreground/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
              id="skill-editor-content"
              onChange={event => setContent(event.target.value)}
              spellCheck={false}
              value={content}
            />
          )}
        </div>

        {error && <p className="whitespace-pre-wrap text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button disabled={saving} onClick={onClose} size="sm" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={saving || loading} onClick={() => void handleSave()} size="sm">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? e.saving : isEdit ? e.saveChanges : e.createSkill}
          </Button>
        </div>
      </div>
    </>
  )
}
