import { afterEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { clearSessionTombstone, markSessionTombstone, mergeSessionPage } from './session'

function session(id: string, lineageRootId?: string): SessionInfo {
  return {
    id,
    ...(lineageRootId ? { _lineage_root_id: lineageRootId } : {})
  } as SessionInfo
}

afterEach(() => {
  clearSessionTombstone('gone')
  clearSessionTombstone('gone-root')
  clearSessionTombstone('keep')
})

describe('mergeSessionPage tombstones', () => {
  it('keeps optimistic deletes from being resurrected by a stale refresh', () => {
    markSessionTombstone('gone', 'gone-root')

    const merged = mergeSessionPage(
      [session('keep')],
      [session('gone', 'gone-root'), session('keep'), session('newer')],
      []
    )

    expect(merged.map(item => item.id)).toEqual(['keep', 'newer'])
  })

  it('still preserves keepIds survivors that are not tombstoned', () => {
    const merged = mergeSessionPage([session('pinned-old')], [session('newer')], ['pinned-old'])

    expect(merged.map(item => item.id)).toEqual(['pinned-old', 'newer'])
  })
})
