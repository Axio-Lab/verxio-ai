import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  orderedProjects,
  orderedSessionIds,
  type ProjectPriority,
  type ProjectSort,
  type SidebarProject
} from '@/app/chat/sidebar/projects'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $sidebarProjects,
  $sidebarProjectsOpen,
  createSidebarProject,
  deleteSidebarProject,
  renameSidebarProject,
  reorderSidebarProjects,
  reorderSidebarProjectSessions,
  setSidebarProjectPriority,
  setSidebarProjectsOpen,
  setSidebarProjectSort
} from '@/store/layout'
import { sessionPinId } from '@/store/session'

import { SidebarPanelLabel } from '../../shell/sidebar-label'

import { SidebarSessionRow } from './session-row'

interface SidebarProjectsSectionProps {
  activeSessionId: null | string
  pinnedSessionIds: string[]
  sessionById: Map<string, SessionInfo>
  workingSessionIdSet: Set<string>
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onResumeSession: (sessionId: string) => void
  onTogglePin: (sessionId: string) => void
}

function sessionActivity(session: SessionInfo | undefined): number {
  if (!session) {
    return 0
  }

  return (session.last_active || session.started_at || 0) * 1000
}

function projectDragId(projectId: string): string {
  return `project:${projectId}`
}

function sessionDragId(projectId: string, sessionId: string): string {
  return `session:${projectId}:${encodeURIComponent(sessionId)}`
}

function parseDragId(
  id: string
): { kind: 'project'; projectId: string } | { kind: 'session'; projectId: string; sessionId: string } | null {
  if (id.startsWith('project:')) {
    return { kind: 'project', projectId: id.slice('project:'.length) }
  }

  if (!id.startsWith('session:')) {
    return null
  }

  const rest = id.slice('session:'.length)
  const sep = rest.indexOf(':')

  if (sep < 0) {
    return null
  }

  return {
    kind: 'session',
    projectId: rest.slice(0, sep),
    sessionId: decodeURIComponent(rest.slice(sep + 1))
  }
}

const PRIORITY_LABEL: Record<ProjectPriority, 'priorityHigh' | 'priorityNormal' | 'priorityLow'> = {
  high: 'priorityHigh',
  normal: 'priorityNormal',
  low: 'priorityLow'
}

export function SidebarProjectsSection({
  activeSessionId,
  pinnedSessionIds,
  sessionById,
  workingSessionIdSet,
  onArchiveSession,
  onDeleteSession,
  onResumeSession,
  onTogglePin
}: SidebarProjectsSectionProps) {
  const { t } = useI18n()
  const s = t.sidebar
  const open = useStore($sidebarProjectsOpen)
  const state = useStore($sidebarProjects)
  const activityOf = (sessionId: string) => sessionActivity(sessionById.get(sessionId))
  const projects = orderedProjects(state, activityOf)
  const manual = state.sort === 'manual'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id

    if (!manual || !overId) {
      return
    }

    const active = parseDragId(String(event.active.id))
    const over = parseDragId(String(overId))

    if (!active || !over) {
      return
    }

    if (active.kind === 'project' && over.kind === 'project') {
      reorderSidebarProjects(active.projectId, over.projectId)

      return
    }

    if (active.kind === 'session' && over.kind === 'session' && active.projectId === over.projectId) {
      reorderSidebarProjectSessions(active.projectId, active.sessionId, over.sessionId)
    }
  }

  const sortableIds = projects.flatMap(project => [
    projectDragId(project.id),
    ...orderedSessionIds(project, state.sort, activityOf).flatMap(id =>
      sessionById.has(id) ? [sessionDragId(project.id, id)] : []
    )
  ])

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const draftRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creating) {
      draftRef.current?.focus()
    }
  }, [creating])

  const startCreate = () => {
    setSidebarProjectsOpen(true)
    setCreating(true)
    setDraft('')
  }

  const commitCreate = () => {
    const name = draft.trim()

    if (name) {
      createSidebarProject(name)
      triggerHaptic('selection')
    }

    setCreating(false)
    setDraft('')
  }

  return (
    <div className="shrink-0 pb-1">
      <div className="group/section flex shrink-0 items-center justify-between pb-1 pt-1.5">
        <button
          className="group/section-label flex w-fit items-center gap-1 bg-transparent text-left leading-none"
          onClick={() => setSidebarProjectsOpen(!open)}
          type="button"
        >
          <SidebarPanelLabel>{s.projects}</SidebarPanelLabel>
          {state.projects.length > 0 && (
            <span className="text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{state.projects.length}</span>
          )}
          <DisclosureCaret
            className="text-(--ui-text-tertiary) opacity-0 transition group-hover/section-label:opacity-100"
            open={open}
          />
        </button>
        <div className="flex items-center">
          <Tip label={s.projectsSort}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={s.projectsSort}
                  className="text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="ellipsis" size="0.75rem" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>{s.sortBy}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  onValueChange={value => setSidebarProjectSort(value as ProjectSort)}
                  value={state.sort}
                >
                  <DropdownMenuRadioItem value="priority">{s.sortPriority}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="updated">{s.sortUpdated}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="manual">{s.sortManual}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Tip>
          <Tip label={s.newProject}>
            <Button
              aria-label={s.newProject}
              className="text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={startCreate}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="add" size="0.75rem" />
            </Button>
          </Tip>
        </div>
      </div>
      {open && (
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} sensors={sensors}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="grid max-h-[calc(4*1.75rem+0.25rem)] gap-px overflow-y-auto overscroll-contain pb-1">
              {creating && (
                <input
                  aria-label={s.newProject}
                  className="mx-1 h-7 rounded-md bg-transparent px-2 text-[0.8125rem] text-foreground outline-none ring-1 ring-(--ui-stroke-tertiary)"
                  onBlur={commitCreate}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitCreate()
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setCreating(false)
                      setDraft('')
                    }
                  }}
                  placeholder={s.projectNamePlaceholder}
                  ref={draftRef}
                  value={draft}
                />
              )}
              {projects.map(project => (
                <ProjectFolder
                  activeSessionId={activeSessionId}
                  activityOf={activityOf}
                  key={project.id}
                  manual={manual}
                  onArchiveSession={onArchiveSession}
                  onDeleteSession={onDeleteSession}
                  onResumeSession={onResumeSession}
                  onTogglePin={onTogglePin}
                  pinnedSessionIds={pinnedSessionIds}
                  project={project}
                  sessionById={sessionById}
                  sort={state.sort}
                  workingSessionIdSet={workingSessionIdSet}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

function ProjectFolder({
  project,
  sort,
  manual,
  activityOf,
  sessionById,
  activeSessionId,
  pinnedSessionIds,
  workingSessionIdSet,
  onArchiveSession,
  onDeleteSession,
  onResumeSession,
  onTogglePin
}: {
  project: SidebarProject
  sort: ProjectSort
  manual: boolean
  activityOf: (sessionId: string) => number
  sessionById: Map<string, SessionInfo>
  activeSessionId: null | string
  pinnedSessionIds: string[]
  workingSessionIdSet: Set<string>
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onResumeSession: (sessionId: string) => void
  onTogglePin: (sessionId: string) => void
}) {
  const { t } = useI18n()
  const s = t.sidebar
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renaming) {
      setDraft(project.name)
    }
  }, [project.name, renaming])

  useEffect(() => {
    if (renaming) {
      inputRef.current?.select()
    }
  }, [renaming])

  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    disabled: !manual,
    id: projectDragId(project.id)
  })

  const commitRename = () => {
    renameSidebarProject(project.id, draft)
    setRenaming(false)
  }

  const sessions = orderedSessionIds(project, sort, activityOf)
    .map(id => sessionById.get(id))
    .filter((session): session is SessionInfo => Boolean(session))

  return (
    <div className="grid gap-px">
      <div
        className={cn(
          'group/project flex min-h-7 items-center gap-1 rounded-md px-1 hover:bg-(--ui-row-hover-background)',
          isDragging && 'z-10 opacity-60'
        )}
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
      >
        {manual && (
          <span
            {...attributes}
            {...listeners}
            aria-label={s.reorderProject(project.name)}
            className="grid w-4 shrink-0 cursor-grab touch-none place-items-center text-(--ui-text-quaternary) opacity-0 active:cursor-grabbing group-hover/project:opacity-80"
          >
            <Codicon name="grabber" size="0.75rem" />
          </span>
        )}
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 bg-transparent py-1 text-left"
          onClick={() => setExpanded(value => !value)}
          type="button"
        >
          <DisclosureCaret className="shrink-0 text-(--ui-text-tertiary)" open={expanded} />
          <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="folder" size="0.875rem" />
          {renaming ? (
            <input
              aria-label={s.renameProject}
              className="h-6 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[0.8125rem] text-foreground outline-none ring-1 ring-(--ui-stroke-tertiary)"
              onBlur={commitRename}
              onChange={event => setDraft(event.target.value)}
              onClick={event => event.stopPropagation()}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitRename()
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  setDraft(project.name)
                  setRenaming(false)
                }
              }}
              ref={inputRef}
              value={draft}
            />
          ) : (
            <>
              <span className="min-w-0 truncate text-[0.8125rem] text-(--ui-text-secondary) group-hover/project:text-foreground">
                {project.name}
              </span>
              {project.sessionIds.length > 0 && (
                <span className="shrink-0 text-[0.6875rem] font-medium text-(--ui-text-quaternary)">
                  {project.sessionIds.length}
                </span>
              )}
            </>
          )}
        </button>
        {!renaming && (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100">
            <Tip label={s.renameProject}>
              <Button
                aria-label={s.renameProject}
                className="size-5 text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                onClick={() => {
                  setExpanded(true)
                  setRenaming(true)
                }}
                size="icon"
                variant="ghost"
              >
                <Codicon name="edit" size="0.75rem" />
              </Button>
            </Tip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={s.projectOptions(project.name)}
                  className="size-5 text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                  size="icon"
                  variant="ghost"
                >
                  <Codicon name="ellipsis" size="0.75rem" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>{s.projectPriority}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  onValueChange={value => {
                    setSidebarProjectPriority(project.id, value as ProjectPriority)
                    triggerHaptic('selection')
                  }}
                  value={project.priority}
                >
                  {(Object.keys(PRIORITY_LABEL) as ProjectPriority[]).map(priority => (
                    <DropdownMenuRadioItem key={priority} value={priority}>
                      {s[PRIORITY_LABEL[priority]]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    triggerHaptic('warning')
                    deleteSidebarProject(project.id)
                  }}
                  variant="destructive"
                >
                  <Codicon name="trash" size="0.875rem" />
                  <span>{s.deleteProject}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {expanded && project.sessionIds.length === 0 && (
        <p className="px-7 pb-1 text-[0.6875rem] text-(--ui-text-quaternary)">{s.projectEmpty}</p>
      )}
      {expanded && sessions.length > 0 && (
        <div className="max-h-[calc(4*1.625rem)] overflow-y-auto overscroll-contain">
          {sessions.map(session => (
            <ProjectSessionRow
              activeSessionId={activeSessionId}
              key={session.id}
              manual={manual}
              onArchiveSession={onArchiveSession}
              onDeleteSession={onDeleteSession}
              onResumeSession={onResumeSession}
              onTogglePin={onTogglePin}
              pinnedSessionIds={pinnedSessionIds}
              projectId={project.id}
              session={session}
              workingSessionIdSet={workingSessionIdSet}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectSessionRow({
  projectId,
  session,
  manual,
  activeSessionId,
  pinnedSessionIds,
  workingSessionIdSet,
  onArchiveSession,
  onDeleteSession,
  onResumeSession,
  onTogglePin
}: {
  projectId: string
  session: SessionInfo
  manual: boolean
  activeSessionId: null | string
  pinnedSessionIds: string[]
  workingSessionIdSet: Set<string>
  onArchiveSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  onResumeSession: (sessionId: string) => void
  onTogglePin: (sessionId: string) => void
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    disabled: !manual,
    id: sessionDragId(projectId, session.id)
  })

  const pinId = sessionPinId(session)

  return (
    <div className="pl-3" ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <SidebarSessionRow
        dragging={isDragging}
        dragHandleProps={manual ? { ...attributes, ...listeners } : undefined}
        isPinned={pinnedSessionIds.includes(pinId)}
        isSelected={session.id === activeSessionId}
        isWorking={workingSessionIdSet.has(session.id)}
        onArchive={() => onArchiveSession(session.id)}
        onDelete={() => onDeleteSession(session.id)}
        onPin={() => onTogglePin(pinId)}
        onResume={() => onResumeSession(session.id)}
        reorderable={manual}
        session={session}
      />
    </div>
  )
}
