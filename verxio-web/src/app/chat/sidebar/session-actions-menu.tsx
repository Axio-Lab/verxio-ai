import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { writeClipboardText } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { renameSession } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { exportSession } from '@/lib/session-export'
import { cn } from '@/lib/utils'
import {
  $sidebarProjects,
  addSessionToSidebarProject,
  createSidebarProject,
  removeSessionsFromSidebarProjects
} from '@/store/layout'
import { notify, notifyError } from '@/store/notifications'
import { setSessions } from '@/store/session'

interface SessionActions {
  sessionId: string
  title: string
  pinId?: string
  pinned?: boolean
  profile?: string
  onPin?: () => void
  onArchive?: () => void
  onDelete?: () => void
}

type MenuItem = typeof DropdownMenuItem | typeof ContextMenuItem

interface ItemSpec {
  className?: string
  disabled: boolean
  icon: string
  label: string
  onSelect: (event: Event) => void
  variant?: 'destructive'
}

function useSessionActions({
  sessionId,
  title,
  pinId,
  pinned = false,
  profile,
  onPin,
  onArchive,
  onDelete
}: SessionActions) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [renameOpen, setRenameOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const folderId = pinId || sessionId

  const items: ItemSpec[] = [
    {
      disabled: !onPin,
      icon: 'pin',
      label: pinned ? r.unpin : r.pin,
      onSelect: () => {
        triggerHaptic('selection')
        onPin?.()
      }
    },
    {
      disabled: !sessionId,
      icon: 'folder',
      label: r.moveToFolder,
      onSelect: () => {
        triggerHaptic('selection')
        setMoveOpen(true)
      }
    },
    {
      disabled: !sessionId,
      icon: 'copy',
      label: r.copyId,
      onSelect: event => {
        event.preventDefault()
        triggerHaptic('selection')
        void writeClipboardText(sessionId).catch(err => notifyError(err, r.copyIdFailed))
      }
    },
    {
      disabled: !sessionId,
      icon: 'cloud-download',
      label: r.export,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSession(sessionId, { title })
      }
    },
    {
      disabled: !sessionId,
      icon: 'edit',
      label: r.rename,
      onSelect: () => {
        triggerHaptic('selection')
        setRenameOpen(true)
      }
    },
    {
      disabled: !onArchive,
      icon: 'archive',
      label: r.archive,
      onSelect: () => {
        triggerHaptic('selection')
        onArchive?.()
      }
    },
    {
      className: 'text-destructive focus:text-destructive',
      disabled: !onDelete,
      icon: 'trash',
      label: t.common.delete,
      onSelect: () => {
        triggerHaptic('warning')
        onDelete?.()
      },
      variant: 'destructive'
    }
  ]

  const renderItems = (Item: MenuItem) =>
    items.map(({ className, disabled, icon, label, onSelect, variant }) => (
      <Item className={className} disabled={disabled} key={label} onSelect={onSelect} variant={variant}>
        <Codicon name={icon} size="0.875rem" />
        <span>{label}</span>
      </Item>
    ))

  const renameDialog = (
    <RenameSessionDialog
      currentTitle={title}
      onOpenChange={setRenameOpen}
      open={renameOpen}
      profile={profile}
      sessionId={sessionId}
    />
  )

  const moveDialog = <MoveToFolderDialog onOpenChange={setMoveOpen} open={moveOpen} pinId={folderId} />

  return { moveDialog, renameDialog, renderItems }
}

interface SessionActionsMenuProps
  extends SessionActions, Pick<React.ComponentProps<typeof DropdownMenuContent>, 'align' | 'sideOffset'> {
  children: React.ReactNode
}

export function SessionActionsMenu({ children, align = 'end', sideOffset = 6, ...actions }: SessionActionsMenuProps) {
  const { t } = useI18n()
  const { moveDialog, renameDialog, renderItems } = useSessionActions(actions)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          aria-label={t.sidebar.row.actionsFor(actions.title)}
          className="w-44"
          sideOffset={sideOffset}
        >
          {renderItems(DropdownMenuItem)}
        </DropdownMenuContent>
      </DropdownMenu>
      {moveDialog}
      {renameDialog}
    </>
  )
}

interface SessionContextMenuProps extends SessionActions {
  children: React.ReactNode
}

export function SessionContextMenu({ children, ...actions }: SessionContextMenuProps) {
  const { t } = useI18n()
  const { moveDialog, renameDialog, renderItems } = useSessionActions(actions)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent aria-label={t.sidebar.row.actionsFor(actions.title)} className="w-44">
          {renderItems(ContextMenuItem)}
        </ContextMenuContent>
      </ContextMenu>
      {moveDialog}
      {renameDialog}
    </>
  )
}

function MoveToFolderDialog({
  open,
  onOpenChange,
  pinId
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pinId: string
}) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const projects = useStore($sidebarProjects).projects
  const current = projects.find(project => project.sessionIds.includes(pinId))
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (open) {
      setDraft('')
    }
  }, [open])

  const choose = (projectId: string) => {
    triggerHaptic('selection')
    addSessionToSidebarProject(projectId, pinId)
    onOpenChange(false)
  }

  const createAndMove = () => {
    const projectId = createSidebarProject(draft)

    if (!projectId) {
      return
    }

    triggerHaptic('selection')
    addSessionToSidebarProject(projectId, pinId)
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{r.moveToFolderTitle}</DialogTitle>
          <DialogDescription>{r.moveToFolderDesc}</DialogDescription>
        </DialogHeader>
        {projects.length === 0 ? (
          <p className="text-sm text-(--ui-text-tertiary)">{r.moveToFolderEmpty}</p>
        ) : (
          <div className="grid max-h-64 gap-0.5 overflow-y-auto">
            {projects.map(project => {
              const selected = project.id === current?.id

              return (
                <button
                  className={cn(
                    'flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-(--ui-control-hover-background)',
                    selected && 'bg-(--ui-control-active-background)'
                  )}
                  key={project.id}
                  onClick={() => choose(project.id)}
                  type="button"
                >
                  <Codicon className="text-(--ui-text-tertiary)" name="folder" size="0.875rem" />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {selected && <Codicon name="check" size="0.75rem" />}
                </button>
              )
            })}
            {current && (
              <button
                className="flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
                onClick={() => {
                  triggerHaptic('selection')
                  removeSessionsFromSidebarProjects([pinId])
                  onOpenChange(false)
                }}
                type="button"
              >
                <Codicon className="text-(--ui-text-tertiary)" name="close" size="0.875rem" />
                <span>{r.removeFromProject}</span>
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                createAndMove()
              }
            }}
            placeholder={r.newFolderPlaceholder}
            value={draft}
          />
          <Button disabled={!draft.trim()} onClick={createAndMove} type="button">
            {t.sidebar.newProject}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface RenameSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentTitle: string
  profile?: string
}

function RenameSessionDialog({ open, onOpenChange, sessionId, currentTitle, profile }: RenameSessionDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [value, setValue] = useState(currentTitle)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(currentTitle)
      window.setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [currentTitle, open])

  const submit = async () => {
    const next = value.trim()

    if (!sessionId || submitting) {
      return
    }

    if (next === currentTitle.trim()) {
      onOpenChange(false)

      return
    }

    setSubmitting(true)

    try {
      const result = await renameSession(sessionId, next, profile)
      const finalTitle = result.title || next || ''
      setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: finalTitle || null } : s)))
      notify({ durationMs: 2_000, kind: 'success', message: r.renamed })
      onOpenChange(false)
    } catch (err) {
      notifyError(err, r.renameFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{r.renameTitle}</DialogTitle>
          <DialogDescription>{r.renameDesc}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          disabled={submitting}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              onOpenChange(false)
            }
          }}
          placeholder={r.untitledPlaceholder}
          ref={inputRef}
          value={value}
        />
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()} type="button">
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
