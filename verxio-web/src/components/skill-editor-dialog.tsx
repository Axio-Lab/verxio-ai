import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createCustomSkill, deleteSkill, getSkillContent, updateSkillContent, writeSkillFiles } from '@/hermes'
import { useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'
import { type ExtractedSkillFile, extractSkillPackage } from '@/lib/skill-package'

const CREATE_TEMPLATE = `---
name: my-skill
description: One-line description of when to use this skill.
---

# My Skill

Numbered steps, exact commands, and pitfalls go here.
`

const DEFAULT_CATEGORY = 'custom'

export interface SkillEditorDialogProps {
  open: boolean
  /** Skill name to edit, or null for create mode. */
  editName: string | null
  /** Profile to scope reads/writes to ("" = the active profile). */
  profile?: string
  onClose: () => void
  /** Called after a successful save so the page can refresh its list. */
  onSaved: (name: string) => void
  /** Called after a successful delete so the page can refresh its list. */
  onDeleted?: (name: string) => void
}

export function SkillEditorDialog({ open, editName, profile, onClose, onSaved, onDeleted }: SkillEditorDialogProps) {
  return (
    <Dialog onOpenChange={next => !next && onClose()} open={open}>
      <DialogContent className="max-w-3xl" showCloseButton={false}>
        {open && (
          <EditorBody
            editName={editName}
            key={editName ?? '__create__'}
            onClose={onClose}
            onDeleted={onDeleted}
            onSaved={onSaved}
            profile={profile}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditorBody({ editName, profile, onClose, onSaved, onDeleted }: Omit<SkillEditorDialogProps, 'open'>) {
  const { t } = useI18n()
  const e = t.skills.editor
  const isEdit = editName !== null
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState(isEdit ? '' : DEFAULT_CATEGORY)
  const [content, setContent] = useState(isEdit ? '' : CREATE_TEMPLATE)
  const [supportFiles, setSupportFiles] = useState<ExtractedSkillFile[]>([])
  const [skippedBinary, setSkippedBinary] = useState<string[]>([])
  const [importNote, setImportNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(isEdit)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
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

  const handleImportFile = async (file: File | undefined) => {
    if (!file) {
      return
    }

    setError(null)
    setImportNote(null)
    setImporting(true)

    try {
      const extracted = await extractSkillPackage(file)
      setName(extracted.name)
      setCategory(extracted.category || DEFAULT_CATEGORY)
      setContent(extracted.content)
      setSupportFiles(extracted.files)
      setSkippedBinary(extracted.skippedBinary)

      const parts: string[] = [e.importReady]

      if (extracted.files.length > 0) {
        parts.push(e.importSupportFiles(extracted.files.length))
      }

      if (extracted.skippedBinary.length > 0) {
        parts.push(e.importSkippedBinary(extracted.skippedBinary.length))
      }

      setImportNote(parts.join(' '))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

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
        const cat = category.trim() || DEFAULT_CATEGORY
        await createCustomSkill(trimmed, content, cat)

        if (supportFiles.length > 0) {
          await writeSkillFiles(trimmed, supportFiles, profile || undefined)
        }

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
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                accept=".zip,.md,text/markdown,application/zip"
                className="sr-only"
                onChange={event => void handleImportFile(event.target.files?.[0])}
                ref={fileInputRef}
                type="file"
              />
              <Button
                disabled={importing || saving}
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                type="button"
                variant="outline"
              >
                {importing && <Loader2 className="size-3.5 animate-spin" />}
                {importing ? e.importing : e.importPackage}
              </Button>
              <p className="text-xs text-muted-foreground">{e.importHint}</p>
            </div>
            {importNote && <p className="text-xs text-muted-foreground">{importNote}</p>}
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
                  placeholder={DEFAULT_CATEGORY}
                  value={category}
                />
              </div>
            </div>
            {supportFiles.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {e.importSupportFiles(supportFiles.length)}
                {skippedBinary.length > 0 ? ` ${e.importSkippedBinary(skippedBinary.length)}` : ''}
              </p>
            )}
          </>
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

        <div className="flex items-center justify-between gap-2">
          <div>
            {isEdit && (
              <Button
                disabled={saving || loading}
                onClick={() => setConfirmDeleteOpen(true)}
                size="sm"
                type="button"
                variant="destructive"
              >
                {e.deleteSkill}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={saving} onClick={onClose} size="sm" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={saving || loading || importing} onClick={() => void handleSave()} size="sm">
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {saving ? e.saving : isEdit ? e.saveChanges : e.createSkill}
            </Button>
          </div>
        </div>
      </div>

      {isEdit && (
        <ConfirmDialog
          busyLabel={e.deleting}
          confirmLabel={e.deleteConfirm}
          description={e.deleteDesc(editName)}
          destructive
          doneLabel={e.deleted}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={async () => {
            await deleteSkill(editName, profile || undefined)
            onDeleted?.(editName)
            onSaved(editName)
            onClose()
          }}
          open={confirmDeleteOpen}
          title={e.deleteTitle(editName)}
        />
      )}
    </>
  )
}
