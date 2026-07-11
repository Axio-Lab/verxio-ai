import { describe, expect, it } from 'vitest'

import { isRetryableSessionListError, shouldRefreshSessions } from './session-list-sync'

describe('shouldRefreshSessions', () => {
  it('returns false on the first poll when the local list already has rows', () => {
    expect(shouldRefreshSessions(null, 's2', 3)).toBe(false)
  })

  it('returns true when the local list is empty but the poll found sessions', () => {
    expect(shouldRefreshSessions(null, 's2', 0)).toBe(true)
  })

  it('returns false when the current response has no sessions', () => {
    expect(shouldRefreshSessions('s1', null, 0)).toBe(false)
    expect(shouldRefreshSessions(null, null, 0)).toBe(false)
  })

  it('returns false when the newest session id is unchanged', () => {
    expect(shouldRefreshSessions('s1', 's1', 2)).toBe(false)
  })

  it('returns true when a new session appears at the head of the list', () => {
    expect(shouldRefreshSessions('s1', 's2', 2)).toBe(true)
  })
})

describe('isRetryableSessionListError', () => {
  it('retries runtime cold-start failures', () => {
    expect(isRetryableSessionListError(new Error('Runtime dashboard is starting. Retry shortly.'))).toBe(true)
    expect(isRetryableSessionListError(new Error('Request failed with status 503'))).toBe(true)
    expect(isRetryableSessionListError(new Error('Validation failed'))).toBe(false)
  })
})
