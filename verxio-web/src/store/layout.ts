import { atom, computed, type ReadableAtom } from 'nanostores'

import {
  addSessionToProject,
  createProject,
  deleteProject,
  emptyProjectsState,
  parseProjectsState,
  type ProjectPriority,
  type ProjectSort,
  removeSessions,
  renameProject,
  reorderProjects,
  reorderProjectSessions,
  setProjectPriority,
  setProjectSort,
  type SidebarProjectsState
} from '@/app/chat/sidebar/projects'
import {
  arraysEqual,
  insertUniqueId,
  persistBoolean,
  persistStringArray,
  storedBoolean,
  storedStringArray
} from '@/lib/storage'

import { $paneStates, ensurePaneRegistered, setPaneOpen, setPaneWidthOverride, togglePane } from './panes'

export const SIDEBAR_DEFAULT_WIDTH = 237
export const SIDEBAR_MAX_WIDTH = 360
// Open at the same width as the sessions sidebar so the two rails match.
export const FILE_BROWSER_DEFAULT_WIDTH = `${SIDEBAR_DEFAULT_WIDTH}px`
export const FILE_BROWSER_MIN_WIDTH = '14rem'
export const FILE_BROWSER_MAX_WIDTH = '20rem'

export const SIDEBAR_SESSIONS_PAGE_SIZE = 50

const SIDEBAR_PINNED_STORAGE_KEY = 'hermes.desktop.pinnedSessions'
const SIDEBAR_PROJECTS_STORAGE_KEY = 'verxio.desktop.sidebarProjects'
const SIDEBAR_PROJECTS_OPEN_STORAGE_KEY = 'verxio.desktop.sidebarProjectsOpen'
const SIDEBAR_AGENTS_GROUPED_STORAGE_KEY = 'hermes.desktop.agentsGroupedByWorkspace'
const SIDEBAR_CRON_OPEN_STORAGE_KEY = 'verxio.web.sidebarCronOpen'
const PANES_FLIPPED_STORAGE_KEY = 'hermes.desktop.panesFlipped'

export const CHAT_SIDEBAR_PANE_ID = 'chat-sidebar'
export const FILE_BROWSER_PANE_ID = 'file-browser'
export const RIGHT_RAIL_PREVIEW_TAB_ID = 'preview'

export type RightRailTabId = typeof RIGHT_RAIL_PREVIEW_TAB_ID | `file:${string}`

ensurePaneRegistered(CHAT_SIDEBAR_PANE_ID, { open: true })
ensurePaneRegistered(FILE_BROWSER_PANE_ID, { open: false })

export const $sidebarOpen: ReadableAtom<boolean> = computed(
  $paneStates,
  states => states[CHAT_SIDEBAR_PANE_ID]?.open ?? true
)

export const $fileBrowserOpen: ReadableAtom<boolean> = computed(
  $paneStates,
  states => states[FILE_BROWSER_PANE_ID]?.open ?? false
)

export const $rightRailActiveTabId = atom<RightRailTabId>(RIGHT_RAIL_PREVIEW_TAB_ID)

export const $sidebarWidth: ReadableAtom<number> = computed($paneStates, states => {
  const override = states[CHAT_SIDEBAR_PANE_ID]?.widthOverride

  return typeof override === 'number' ? override : SIDEBAR_DEFAULT_WIDTH
})

export const $pinnedSessionIds = atom(storedStringArray(SIDEBAR_PINNED_STORAGE_KEY))
export const $sidebarProjects = atom(storedProjectsState())
/** Folder that should receive the next chat created from a fresh draft. */
const $newSessionProjectId = atom<null | string>(null)
export const $sidebarProjectsOpen = atom(storedBoolean(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, true))
export const $sidebarPinsOpen = atom(true)
export const $sidebarRecentsOpen = atom(true)
export const $sidebarCronOpen = atom(storedBoolean(SIDEBAR_CRON_OPEN_STORAGE_KEY, false))
export const $sidebarAgentsGrouped = atom(storedBoolean(SIDEBAR_AGENTS_GROUPED_STORAGE_KEY, false))
// When true, the sessions sidebar moves to the right and the file browser +
// preview rail move to the left — a mirror of the default layout.
export const $panesFlipped = atom(storedBoolean(PANES_FLIPPED_STORAGE_KEY, false))
export const $isSidebarResizing = atom(false)
export const $sessionsLimit = atom(SIDEBAR_SESSIONS_PAGE_SIZE)

$pinnedSessionIds.subscribe(ids => persistStringArray(SIDEBAR_PINNED_STORAGE_KEY, [...ids]))
$sidebarProjects.subscribe(state => persistProjectsState(state))
$sidebarProjectsOpen.subscribe(open => persistBoolean(SIDEBAR_PROJECTS_OPEN_STORAGE_KEY, open))
$sidebarAgentsGrouped.subscribe(grouped => persistBoolean(SIDEBAR_AGENTS_GROUPED_STORAGE_KEY, grouped))
$sidebarCronOpen.subscribe(open => persistBoolean(SIDEBAR_CRON_OPEN_STORAGE_KEY, open))
$panesFlipped.subscribe(flipped => persistBoolean(PANES_FLIPPED_STORAGE_KEY, flipped))

export function setSidebarWidth(width: number) {
  const bounded = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_DEFAULT_WIDTH, width))
  setPaneWidthOverride(CHAT_SIDEBAR_PANE_ID, bounded)
}

export function setSidebarOpen(open: boolean) {
  setPaneOpen(CHAT_SIDEBAR_PANE_ID, open)
}

export function toggleSidebarOpen() {
  togglePane(CHAT_SIDEBAR_PANE_ID)
}

export function toggleFileBrowserOpen() {
  togglePane(FILE_BROWSER_PANE_ID)
}

export function setFileBrowserOpen(open: boolean) {
  setPaneOpen(FILE_BROWSER_PANE_ID, open)
}

// Hotkey → focus the sessions search field. Opens the sidebar first, then lets
// the field (which only mounts when the sidebar is open) subscribe + focus.
export const SESSION_SEARCH_FOCUS_EVENT = 'hermes:focus-session-search'

export function requestSessionSearchFocus() {
  setSidebarOpen(true)

  if (typeof window !== 'undefined') {
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(SESSION_SEARCH_FOCUS_EVENT)), 0)
  }
}

export function togglePanesFlipped() {
  $panesFlipped.set(!$panesFlipped.get())
}

export function selectRightRailTab(id: RightRailTabId) {
  $rightRailActiveTabId.set(id)
}

export function setSidebarPinsOpen(open: boolean) {
  $sidebarPinsOpen.set(open)
}

export function setSidebarRecentsOpen(open: boolean) {
  $sidebarRecentsOpen.set(open)
}

export function setSidebarCronOpen(open: boolean) {
  $sidebarCronOpen.set(open)
}

export function setSidebarAgentsGrouped(grouped: boolean) {
  $sidebarAgentsGrouped.set(grouped)
}

export function setSidebarResizing(resizing: boolean) {
  $isSidebarResizing.set(resizing)
}

export function pinSession(sessionId: string, index?: number) {
  const prev = $pinnedSessionIds.get()
  const next = insertUniqueId(prev, sessionId, index ?? prev.filter(id => id !== sessionId).length)

  if (!arraysEqual(prev, next)) {
    $pinnedSessionIds.set(next)
  }
}

export function unpinSession(sessionId: string) {
  const prev = $pinnedSessionIds.get()
  const next = prev.filter(id => id !== sessionId)

  if (!arraysEqual(prev, next)) {
    $pinnedSessionIds.set(next)
  }
}

export function reorderPinnedSession(sessionId: string, targetIndex: number) {
  const prev = $pinnedSessionIds.get()

  if (!prev.includes(sessionId)) {
    return
  }

  const next = insertUniqueId(prev, sessionId, targetIndex)

  if (!arraysEqual(prev, next)) {
    $pinnedSessionIds.set(next)
  }
}

export function bumpSessionsLimit(step: number = SIDEBAR_SESSIONS_PAGE_SIZE) {
  const safeStep = Math.max(1, Math.floor(step))
  $sessionsLimit.set($sessionsLimit.get() + safeStep)
}

export function resetSessionsLimit() {
  if ($sessionsLimit.get() !== SIDEBAR_SESSIONS_PAGE_SIZE) {
    $sessionsLimit.set(SIDEBAR_SESSIONS_PAGE_SIZE)
  }
}

export function setSidebarProjectsOpen(open: boolean) {
  $sidebarProjectsOpen.set(open)
}

function updateProjects(recipe: (state: SidebarProjectsState) => SidebarProjectsState) {
  const prev = $sidebarProjects.get()
  const next = recipe(prev)

  if (next !== prev) {
    $sidebarProjects.set(next)
  }
}

export function createSidebarProject(name: string): null | string {
  const prev = $sidebarProjects.get()
  const next = createProject(prev, name)

  if (next === prev) {
    return null
  }

  $sidebarProjects.set(next)

  const previousIds = new Set(prev.projects.map(project => project.id))

  return next.projects.find(project => !previousIds.has(project.id))?.id ?? null
}

export function armNewSessionInProject(projectId: string) {
  $newSessionProjectId.set(projectId)
}

export function armedNewSessionProject(): null | string {
  return $newSessionProjectId.get()
}

export function clearNewSessionProject() {
  if ($newSessionProjectId.get() !== null) {
    $newSessionProjectId.set(null)
  }
}

/** The folder still waiting for this draft, or null if the user left that draft. */
export function projectForNewSession(armedProjectId: null | string): null | string {
  if (!armedProjectId || $newSessionProjectId.get() !== armedProjectId) {
    return null
  }

  $newSessionProjectId.set(null)

  return armedProjectId
}

export function renameSidebarProject(projectId: string, name: string) {
  updateProjects(state => renameProject(state, projectId, name))
}

export function deleteSidebarProject(projectId: string) {
  updateProjects(state => deleteProject(state, projectId))
}

export function setSidebarProjectPriority(projectId: string, priority: ProjectPriority) {
  updateProjects(state => setProjectPriority(state, projectId, priority))
}

export function setSidebarProjectSort(sort: ProjectSort) {
  updateProjects(state => setProjectSort(state, sort))
}

export function addSessionToSidebarProject(projectId: string, sessionId: string) {
  updateProjects(state => addSessionToProject(state, projectId, sessionId))
}

export function removeSessionsFromSidebarProjects(sessionIds: string[]) {
  updateProjects(state => removeSessions(state, sessionIds))
}

export function reorderSidebarProjects(activeId: string, overId: string) {
  updateProjects(state => reorderProjects(state, activeId, overId))
}

export function reorderSidebarProjectSessions(projectId: string, activeId: string, overId: string) {
  updateProjects(state => reorderProjectSessions(state, projectId, activeId, overId))
}

function storedProjectsState(): SidebarProjectsState {
  if (typeof window === 'undefined') {
    return emptyProjectsState()
  }

  try {
    const value = window.localStorage.getItem(SIDEBAR_PROJECTS_STORAGE_KEY)

    return value ? parseProjectsState(JSON.parse(value)) : emptyProjectsState()
  } catch {
    return emptyProjectsState()
  }
}

function persistProjectsState(state: SidebarProjectsState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(SIDEBAR_PROJECTS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Project folders are a local preference.
  }
}
