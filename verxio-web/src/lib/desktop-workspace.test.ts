import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isRuntimeWorkspacePath,
  resolveDesktopWorkspaceCwd,
  rewriteRuntimePathsInText,
  setDesktopWorkspaceRoot
} from './desktop-workspace'

describe('desktop-workspace', () => {
  beforeEach(() => {
    vi.stubGlobal('hermesDesktop', {})
    vi.stubGlobal('__VERXIO_WEB__', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setDesktopWorkspaceRoot(null)
  })
  it('detects runtime workspace paths', () => {
    expect(isRuntimeWorkspacePath('/workspace')).toBe(true)
    expect(isRuntimeWorkspacePath('/workspace/src')).toBe(true)
    expect(isRuntimeWorkspacePath('/Users/me/Verxio')).toBe(false)
  })

  it('maps runtime cwd to the local desktop workspace', () => {
    const local = '/Users/me/Documents/Verxio'

    expect(resolveDesktopWorkspaceCwd('/workspace', local)).toBe(local)
    expect(resolveDesktopWorkspaceCwd('/workspace/src', local)).toBe(`${local}/src`)
    expect(resolveDesktopWorkspaceCwd('/Users/me/projects/app', local)).toBe('/Users/me/projects/app')
  })

  it('rewrites runtime workspace paths in assistant copy for desktop', () => {
    const local = '/Users/me/Documents/Verxio'

    setDesktopWorkspaceRoot(local)

    expect(
      rewriteRuntimePathsInText('I can build a prototype in /workspace/artifacts that accepts CSV transactions.')
    ).toBe(`I can build a prototype in ${local}/artifacts that accepts CSV transactions.`)

    setDesktopWorkspaceRoot(null)

    // Before the local root resolves, the raw /workspace path is preserved so
    // it stays a single clickable token and resolves locally once root lands.
    expect(rewriteRuntimePathsInText('Use /workspace/artifacts for output.')).toBe(
      'Use /workspace/artifacts for output.'
    )
  })
})
