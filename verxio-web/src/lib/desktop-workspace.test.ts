import { describe, expect, it } from 'vitest'

import { isRuntimeWorkspacePath, resolveDesktopWorkspaceCwd } from './desktop-workspace'

describe('desktop-workspace', () => {
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
})
