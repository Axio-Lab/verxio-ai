import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearStaleChunkReloadGuard, isStaleChunkError, reloadOnceForStaleChunk } from './stale-chunk'

describe('stale-chunk', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('detects Vite dynamic import failures', () => {
    expect(
      isStaleChunkError(
        new Error('Failed to fetch dynamically imported module: http://127.0.0.1:8080/assets/artifacts-BKtAUIOc.js')
      )
    ).toBe(true)
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new Error('session busy'))).toBe(false)
  })

  it('reloads once per tab session for stale chunks', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    expect(
      reloadOnceForStaleChunk(
        new Error('Failed to fetch dynamically imported module: http://127.0.0.1:8080/assets/artifacts-old.js')
      )
    ).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)

    expect(
      reloadOnceForStaleChunk(
        new Error('Failed to fetch dynamically imported module: http://127.0.0.1:8080/assets/artifacts-old.js')
      )
    ).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated errors', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    expect(reloadOnceForStaleChunk(new Error('session busy'))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('allows another reload after the guard is cleared', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    expect(reloadOnceForStaleChunk()).toBe(true)
    clearStaleChunkReloadGuard()
    expect(reloadOnceForStaleChunk()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
