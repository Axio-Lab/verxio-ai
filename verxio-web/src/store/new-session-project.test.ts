import { describe, expect, it } from 'vitest'

import { armNewSessionInProject, clearNewSessionProject, projectForNewSession } from './layout'

describe('new session in a folder', () => {
  it('files the chat only while that draft is still the one the user started', () => {
    clearNewSessionProject()
    armNewSessionInProject('proj_a')

    expect(projectForNewSession('proj_a')).toBe('proj_a')
    expect(projectForNewSession('proj_a')).toBeNull()
  })

  it('leaves a later folder choice alone when an older draft finishes', () => {
    clearNewSessionProject()
    armNewSessionInProject('proj_a')
    clearNewSessionProject()
    armNewSessionInProject('proj_b')

    expect(projectForNewSession('proj_a')).toBeNull()
    expect(projectForNewSession('proj_b')).toBe('proj_b')
  })
})
