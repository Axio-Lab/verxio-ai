import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isVerxioDesktop, getDesktopWorkspaceRoot, resolveDesktopWorkspaceCwd, verxioArtifactPreviewTarget } =
  vi.hoisted(() => ({
    getDesktopWorkspaceRoot: vi.fn(() => '/Users/me/project'),
    isVerxioDesktop: vi.fn(() => false),
    resolveDesktopWorkspaceCwd: vi.fn((path: string, root: string | null) => {
      if (!root) {
        return null
      }

      if (path === '/workspace' || path.startsWith('/workspace/')) {
        return path.replace(/^\/workspace/, root)
      }

      return null
    }),
    verxioArtifactPreviewTarget: vi.fn(async () => null)
  }))

vi.mock('./desktop-workspace', () => ({
  getDesktopWorkspaceRoot,
  isRuntimeWorkspacePath: (pathValue: string) => {
    const trimmed = pathValue.trim()

    return trimmed === '/workspace' || trimmed.startsWith('/workspace/')
  },
  isVerxioDesktop,
  resolveDesktopWorkspaceCwd
}))

vi.mock('./verxio-artifact-preview', () => ({
  verxioArtifactPreviewTarget
}))

import { localPreviewTarget, normalizeOrLocalPreviewTarget } from './local-preview'

describe('localPreviewTarget', () => {
  beforeEach(() => {
    isVerxioDesktop.mockReturnValue(false)
    verxioArtifactPreviewTarget.mockReset()
    verxioArtifactPreviewTarget.mockResolvedValue(null)
  })

  it('treats bare localhost targets as http URLs', () => {
    expect(localPreviewTarget('localhost:8080')).toEqual({
      kind: 'url',
      label: 'localhost:8080',
      source: 'localhost:8080',
      url: 'http://localhost:8080'
    })
  })

  it('maps /workspace artifacts to the desktop project folder', () => {
    isVerxioDesktop.mockReturnValue(true)

    const target = localPreviewTarget('/workspace/artifacts/webinar-landing.html')

    expect(target?.kind).toBe('file')
    expect(target?.path).toBe('/Users/me/project/artifacts/webinar-landing.html')
    expect(target?.previewKind).toBe('html')
    expect(target?.url).toContain('file://')
  })
})

describe('normalizeOrLocalPreviewTarget', () => {
  beforeEach(() => {
    isVerxioDesktop.mockReturnValue(false)
    verxioArtifactPreviewTarget.mockReset()
    verxioArtifactPreviewTarget.mockResolvedValue(null)

    // Vitest node env has no browser window; stub only when present.
    if (typeof globalThis.window !== 'undefined') {
      delete (globalThis.window as { hermesDesktop?: unknown }).hermesDesktop
    }
  })

  it('uses the Verxio artifacts API on hosted web for workspace HTML', async () => {
    verxioArtifactPreviewTarget.mockResolvedValue({
      kind: 'url',
      label: 'webinar-landing.html',
      previewKind: 'html',
      source: '/workspace/artifacts/webinar-landing.html',
      url: 'https://app.verxio.xyz/api/artifacts/art_123/preview'
    })

    const target = await normalizeOrLocalPreviewTarget('/workspace/artifacts/webinar-landing.html')

    expect(verxioArtifactPreviewTarget).toHaveBeenCalled()
    expect(target?.url).toBe('https://app.verxio.xyz/api/artifacts/art_123/preview')
  })

  it('does not return blocked file:// workspace URLs on hosted web', async () => {
    const target = await normalizeOrLocalPreviewTarget('/workspace/artifacts/webinar-landing.html')

    expect(target).toBeNull()
  })

  it('prefers desktop local files over the artifacts API', async () => {
    isVerxioDesktop.mockReturnValue(true)
    verxioArtifactPreviewTarget.mockResolvedValue({
      kind: 'url',
      label: 'webinar-landing.html',
      previewKind: 'html',
      source: '/workspace/artifacts/webinar-landing.html',
      url: 'http://127.0.0.1:8787/api/artifacts/art_123/preview'
    })

    const target = await normalizeOrLocalPreviewTarget('/workspace/artifacts/webinar-landing.html')

    expect(verxioArtifactPreviewTarget).not.toHaveBeenCalled()
    expect(target?.kind).toBe('file')
    expect(target?.path).toBe('/Users/me/project/artifacts/webinar-landing.html')
  })

  it('keeps localhost previews as URLs on both platforms', async () => {
    isVerxioDesktop.mockReturnValue(true)

    const target = await normalizeOrLocalPreviewTarget('localhost:5173')

    expect(target).toEqual({
      kind: 'url',
      label: 'localhost:5173',
      source: 'localhost:5173',
      url: 'http://localhost:5173'
    })
  })
})
