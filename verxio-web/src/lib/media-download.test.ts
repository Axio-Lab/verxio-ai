import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreviewTarget } from '@/store/preview'

const { verxioArtifactPreviewTarget } = vi.hoisted(() => ({
  verxioArtifactPreviewTarget: vi.fn(async (): Promise<PreviewTarget | null> => null)
}))

vi.mock('./verxio-artifact-preview', () => ({
  verxioArtifactPreviewTarget
}))

vi.mock('./verxio-api', () => ({
  verxioApiUrl: (path: string) => path
}))

import {
  artifactDownloadUrlFromSrc,
  downloadMediaFromCandidates,
  mediaFilename,
  startBrowserDownload
} from './media-download'

describe('artifactDownloadUrlFromSrc', () => {
  it('maps preview URLs to download URLs', () => {
    expect(artifactDownloadUrlFromSrc('/api/artifacts/art_123/preview')).toBe('/api/artifacts/art_123/download')
    expect(artifactDownloadUrlFromSrc('https://app.example/api/artifacts/art_123/preview?x=1')).toBe(
      'https://app.example/api/artifacts/art_123/download?x=1'
    )
  })

  it('returns null for non-artifact URLs', () => {
    expect(artifactDownloadUrlFromSrc('https://cdn.example/cat.png')).toBeNull()
  })
})

describe('mediaFilename', () => {
  it('reads the leaf path segment', () => {
    expect(mediaFilename('https://cdn.example/path/cat.png')).toBe('cat.png')
  })
})

describe('startBrowserDownload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    verxioArtifactPreviewTarget.mockReset()
    verxioArtifactPreviewTarget.mockResolvedValue(null)
  })

  it('fetches the artifact download endpoint with credentials', async () => {
    const click = vi.fn()
    const remove = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return {
          click,
          remove,
          set href(_v: string) {},
          set download(_v: string) {},
          set rel(_v: string) {}
        } as unknown as HTMLAnchorElement
      }

      return document.createElement(tag)
    })
    vi.spyOn(document.body, 'appendChild').mockImplementation(node => node)

    const blob = new Blob(['png'], { type: 'image/png' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('/api/artifacts/art_abc/download')
        expect(init?.credentials).toBe('include')

        return new Response(blob, {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="family.png"' }
        })
      })
    )
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn()
    })

    await startBrowserDownload('/api/artifacts/art_abc/preview')
    expect(click).toHaveBeenCalled()
  })
})

describe('downloadMediaFromCandidates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    verxioArtifactPreviewTarget.mockReset()
  })

  it('resolves a workspace path through the artifacts download API', async () => {
    verxioArtifactPreviewTarget.mockResolvedValue({
      kind: 'url',
      label: 'apple.png',
      previewKind: 'image',
      source: '/workspace/artifacts/apple.png',
      url: '/api/artifacts/art_apple/preview'
    })

    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return {
          click,
          remove: vi.fn(),
          set href(_v: string) {},
          set download(_v: string) {},
          set rel(_v: string) {}
        } as unknown as HTMLAnchorElement
      }

      return document.createElement(tag)
    })
    vi.spyOn(document.body, 'appendChild').mockImplementation(node => node)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Blob(['x']), {
            status: 200,
            headers: { 'content-disposition': 'attachment; filename="apple.png"' }
          })
      )
    )
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn()
    })

    await expect(downloadMediaFromCandidates(['/workspace/artifacts/apple.png'])).resolves.toBe('download')
    expect(fetch).toHaveBeenCalledWith('/api/artifacts/art_apple/download', { credentials: 'include' })
    expect(click).toHaveBeenCalled()
  })
})
