export type ProjectPriority = 'high' | 'normal' | 'low'
export type ProjectSort = 'priority' | 'updated' | 'manual'

export interface SidebarProject {
  id: string
  name: string
  sessionIds: string[]
  priority: ProjectPriority
  updatedAt: number
}

export interface SidebarProjectsState {
  sort: ProjectSort
  projects: SidebarProject[]
  /** Saves from before recency was the default have no version and used manual order. */
  orderVersion: number
}

const PRIORITY_RANK: Record<ProjectPriority, number> = { high: 0, normal: 1, low: 2 }
const SORTS = new Set<ProjectSort>(['priority', 'updated', 'manual'])
const PRIORITIES = new Set<ProjectPriority>(['high', 'normal', 'low'])
const PROJECT_ORDER_VERSION = 1

export function emptyProjectsState(): SidebarProjectsState {
  return { sort: 'updated', projects: [], orderVersion: PROJECT_ORDER_VERSION }
}

export function projectSessionIdSet(state: SidebarProjectsState): Set<string> {
  const ids = new Set<string>()

  for (const project of state.projects) {
    for (const id of project.sessionIds) {
      ids.add(id)
    }
  }

  return ids
}

function newProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `proj_${crypto.randomUUID()}`
  }

  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function parseProject(value: unknown): SidebarProject | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? cleanName(record.name) : ''
  const id = typeof record.id === 'string' ? record.id.trim() : ''

  if (!name || !id) {
    return null
  }

  const sessionIds = Array.isArray(record.sessionIds)
    ? record.sessionIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []

  const priority = PRIORITIES.has(record.priority as ProjectPriority) ? (record.priority as ProjectPriority) : 'normal'
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0

  return { id, name, sessionIds, priority, updatedAt }
}

export function parseProjectsState(value: unknown): SidebarProjectsState {
  if (!value || typeof value !== 'object') {
    return emptyProjectsState()
  }

  const record = value as Record<string, unknown>
  const savedVersion =
    typeof record.orderVersion === 'number' && Number.isFinite(record.orderVersion) ? record.orderVersion : 0
  let sort = SORTS.has(record.sort as ProjectSort) ? (record.sort as ProjectSort) : 'updated'

  // Manual used to be the untouched default, so an old save is not a choice to
  // keep append order. A later explicit Manual choice is stored with a version.
  if (savedVersion < PROJECT_ORDER_VERSION && sort === 'manual') {
    sort = 'updated'
  }

  const projects = Array.isArray(record.projects)
    ? record.projects.map(parseProject).filter((project): project is SidebarProject => project !== null)
    : []

  return { sort, projects, orderVersion: PROJECT_ORDER_VERSION }
}

export function createProject(
  state: SidebarProjectsState,
  name: string,
  now = Date.now(),
  id = newProjectId()
): SidebarProjectsState {
  const cleaned = cleanName(name)

  if (!cleaned) {
    return state
  }

  return {
    ...state,
    projects: [{ id, name: cleaned, sessionIds: [], priority: 'normal', updatedAt: now }, ...state.projects]
  }
}

export function renameProject(
  state: SidebarProjectsState,
  projectId: string,
  name: string,
  now = Date.now()
): SidebarProjectsState {
  const cleaned = cleanName(name)

  if (!cleaned) {
    return state
  }

  let changed = false

  const projects = state.projects.map(project => {
    if (project.id !== projectId || project.name === cleaned) {
      return project
    }

    changed = true

    return { ...project, name: cleaned, updatedAt: now }
  })

  return changed ? { ...state, projects } : state
}

export function deleteProject(state: SidebarProjectsState, projectId: string): SidebarProjectsState {
  const projects = state.projects.filter(project => project.id !== projectId)

  return projects.length === state.projects.length ? state : { ...state, projects }
}

export function setProjectPriority(
  state: SidebarProjectsState,
  projectId: string,
  priority: ProjectPriority,
  now = Date.now()
): SidebarProjectsState {
  let changed = false

  const projects = state.projects.map(project => {
    if (project.id !== projectId || project.priority === priority) {
      return project
    }

    changed = true

    return { ...project, priority, updatedAt: now }
  })

  return changed ? { ...state, projects } : state
}

export function setProjectSort(state: SidebarProjectsState, sort: ProjectSort): SidebarProjectsState {
  return state.sort === sort ? state : { ...state, sort }
}

/** A chat lives in at most one project. Adding it moves it out of any other folder. */
export function addSessionToProject(
  state: SidebarProjectsState,
  projectId: string,
  sessionId: string,
  now = Date.now()
): SidebarProjectsState {
  if (!sessionId || !state.projects.some(project => project.id === projectId)) {
    return state
  }

  let changed = false

  const projects = state.projects.map(project => {
    const without = project.sessionIds.filter(id => id !== sessionId)
    const nextIds = project.id === projectId ? [sessionId, ...without] : without

    if (
      nextIds.length === project.sessionIds.length &&
      nextIds.every((id, index) => id === project.sessionIds[index])
    ) {
      return project
    }

    changed = true

    return { ...project, sessionIds: nextIds, updatedAt: project.id === projectId ? now : project.updatedAt }
  })

  return changed ? { ...state, projects } : state
}

export function removeSessions(
  state: SidebarProjectsState,
  sessionIds: string[],
  now = Date.now()
): SidebarProjectsState {
  const drop = new Set(sessionIds.filter(Boolean))

  if (drop.size === 0) {
    return state
  }

  let changed = false

  const projects = state.projects.map(project => {
    const sessionIdsNext = project.sessionIds.filter(id => !drop.has(id))

    if (sessionIdsNext.length === project.sessionIds.length) {
      return project
    }

    changed = true

    return { ...project, sessionIds: sessionIdsNext, updatedAt: now }
  })

  return changed ? { ...state, projects } : state
}

export function reorderProjects(state: SidebarProjectsState, activeId: string, overId: string): SidebarProjectsState {
  const from = state.projects.findIndex(project => project.id === activeId)
  const to = state.projects.findIndex(project => project.id === overId)

  if (from < 0 || to < 0 || from === to) {
    return state
  }

  const projects = state.projects.slice()
  const [moved] = projects.splice(from, 1)
  projects.splice(to, 0, moved)

  return { ...state, projects }
}

export function reorderProjectSessions(
  state: SidebarProjectsState,
  projectId: string,
  activeId: string,
  overId: string
): SidebarProjectsState {
  const projects = state.projects.map(project => {
    if (project.id !== projectId) {
      return project
    }

    const from = project.sessionIds.indexOf(activeId)
    const to = project.sessionIds.indexOf(overId)

    if (from < 0 || to < 0 || from === to) {
      return project
    }

    const sessionIds = project.sessionIds.slice()
    const [moved] = sessionIds.splice(from, 1)
    sessionIds.splice(to, 0, moved)

    return { ...project, sessionIds }
  })

  return projects === state.projects || projects.every((project, index) => project === state.projects[index])
    ? state
    : { ...state, projects }
}

export function projectActivity(project: SidebarProject, activityOf: (sessionId: string) => number): number {
  let latest = project.updatedAt

  for (const id of project.sessionIds) {
    latest = Math.max(latest, activityOf(id) || 0)
  }

  return latest
}

export function orderedProjects(
  state: SidebarProjectsState,
  activityOf: (sessionId: string) => number
): SidebarProject[] {
  if (state.sort === 'manual') {
    return state.projects
  }

  const projects = state.projects.slice()

  if (state.sort === 'priority') {
    projects.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name))
  } else {
    projects.sort(
      (a, b) => projectActivity(b, activityOf) - projectActivity(a, activityOf) || a.name.localeCompare(b.name)
    )
  }

  return projects
}

export function orderedSessionIds(
  project: SidebarProject,
  sort: ProjectSort,
  activityOf: (sessionId: string) => number
): string[] {
  if (sort !== 'updated') {
    return project.sessionIds
  }

  return project.sessionIds.slice().sort((a, b) => (activityOf(b) || 0) - (activityOf(a) || 0))
}
