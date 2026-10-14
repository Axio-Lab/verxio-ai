import { describe, expect, it } from 'vitest'

import {
  addSessionToProject,
  createProject,
  deleteProject,
  emptyProjectsState,
  orderedProjects,
  orderedSessionIds,
  parseProjectsState,
  projectSessionIdSet,
  removeSessions,
  renameProject,
  reorderProjects,
  reorderProjectSessions,
  setProjectPriority,
  setProjectSort
} from './projects'

describe('sidebar projects', () => {
  it('ignores a blank name and keeps stored order', () => {
    const created = createProject(emptyProjectsState(), '  Launch plan  ', 10, 'proj_a')

    expect(createProject(created, '   ', 11, 'proj_b')).toBe(created)
    expect(created.projects).toEqual([
      { id: 'proj_a', name: 'Launch plan', sessionIds: [], priority: 'normal', updatedAt: 10 }
    ])
  })

  it('renames, sets priority, and deletes without touching other folders', () => {
    const start = createProject(createProject(emptyProjectsState(), 'A', 1, 'a'), 'B', 2, 'b')
    const renamed = renameProject(start, 'a', 'Alpha', 3)
    const prioritized = setProjectPriority(renamed, 'b', 'high', 4)

    expect(renamed.projects.find(project => project.id === 'a')).toMatchObject({ name: 'Alpha', updatedAt: 3 })
    expect(prioritized.projects.find(project => project.id === 'b')).toMatchObject({ priority: 'high', updatedAt: 4 })
    expect(deleteProject(prioritized, 'a').projects.map(project => project.id)).toEqual(['b'])
    expect(renameProject(prioritized, 'missing', 'Nope', 5)).toBe(prioritized)
  })

  it('keeps a chat in only one project', () => {
    const start = createProject(createProject(emptyProjectsState(), 'A', 1, 'a'), 'B', 2, 'b')
    const filed = addSessionToProject(addSessionToProject(start, 'a', 's1', 3), 'b', 's1', 4)

    expect(filed.projects.find(project => project.id === 'a')?.sessionIds).toEqual([])
    expect(filed.projects.find(project => project.id === 'b')?.sessionIds).toEqual(['s1'])
    expect([...projectSessionIdSet(filed)]).toEqual(['s1'])
    expect(removeSessions(filed, ['s1'], 5).projects.every(project => project.sessionIds.length === 0)).toBe(true)
  })

  it('sorts by priority, last update, and manual order', () => {
    let state = createProject(emptyProjectsState(), 'Later', 1, 'later')
    state = createProject(state, 'Now', 2, 'now')
    state = setProjectPriority(state, 'now', 'high', 3)
    state = addSessionToProject(state, 'later', 'chat', 4)
    const activity = (id: string) => (id === 'chat' ? 50 : 0)

    expect(orderedProjects(setProjectSort(state, 'updated'), activity).map(project => project.id)).toEqual([
      'later',
      'now'
    ])
    expect(orderedProjects(setProjectSort(state, 'priority'), activity).map(project => project.id)).toEqual([
      'now',
      'later'
    ])
    expect(orderedProjects(setProjectSort(state, 'manual'), activity).map(project => project.id)).toEqual([
      'now',
      'later'
    ])
    expect(orderedSessionIds(state.projects.find(project => project.id === 'later')!, 'updated', activity)).toEqual([
      'chat'
    ])
  })

  it('puts the newest folder and the newest chat first', () => {
    let state = createProject(emptyProjectsState(), 'Older', 1, 'older')
    state = createProject(state, 'Newer', 2, 'newer')
    state = addSessionToProject(state, 'newer', 'old-chat', 3)
    state = addSessionToProject(state, 'newer', 'new-chat', 4)
    const activity = (id: string) => (id === 'new-chat' ? 90 : id === 'old-chat' ? 10 : 0)

    expect(state.projects.map(project => project.id)).toEqual(['newer', 'older'])
    expect(state.projects[0].sessionIds).toEqual(['new-chat', 'old-chat'])
    expect(orderedProjects(state, activity).map(project => project.id)).toEqual(['newer', 'older'])
    expect(orderedSessionIds(state.projects[0], state.sort, activity)).toEqual(['new-chat', 'old-chat'])
  })

  it('reorders folders and the chats inside one folder', () => {
    let state = createProject(createProject(emptyProjectsState(), 'A', 1, 'a'), 'B', 2, 'b')
    state = addSessionToProject(addSessionToProject(state, 'a', 's1', 3), 'a', 's2', 4)
    state = reorderProjects(state, 'a', 'b')
    state = reorderProjectSessions(state, 'a', 's1', 's2')

    expect(state.projects.map(project => project.id)).toEqual(['a', 'b'])
    expect(state.projects[0].sessionIds).toEqual(['s1', 's2'])
    expect(reorderProjects(state, 'missing', 'a')).toBe(state)
  })

  it('drops malformed saved state', () => {
    expect(parseProjectsState(null)).toEqual(emptyProjectsState())
    expect(
      parseProjectsState({
        sort: 'nope',
        projects: [{ id: 'ok', name: '  Kept  ', sessionIds: ['s1', 2], priority: 'high', updatedAt: 8 }, { name: '' }]
      })
    ).toEqual({
      sort: 'updated',
      projects: [{ id: 'ok', name: 'Kept', sessionIds: ['s1'], priority: 'high', updatedAt: 8 }],
      orderVersion: 1
    })
    expect(parseProjectsState({ sort: 'manual', projects: [] }).sort).toBe('updated')
    expect(parseProjectsState({ sort: 'manual', orderVersion: 1, projects: [] }).sort).toBe('manual')
  })
})
