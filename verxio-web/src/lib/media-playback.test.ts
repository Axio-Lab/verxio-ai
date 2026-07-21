import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreviewTarget } from '@/store/preview'

const { isVerxioDesktop, isVerxioWeb, verxioArtifactPreviewTarget } = vi.hoisted(() => ({
  isVerxioDesktop: vi.fn(() => false),
  isVerxioWeb: vi.fn(() => true),
  verxioArtifactPreviewTarget: vi.fn(async (): Promise<PreviewTarget | null> => null)
}))

vi.mock('./platform', () => ({
  isVerxioDesktop,
  isVerxioWeb
}))

vi.mock('./verxio-artifact-preview', () => ({
  verxioArtifactPreviewTarget
}))

import { resolveMediaPlaybackSrc } from './media-playback'

describe('resolveMediaPlaybackSrc', () => {
  beforeEach(() => {
    isVerxioDesktop.mockReturnValue(false)
    isVerxioWeb.mockReturnValue(true)
    verxioArtifactPreviewTarget.mockReset()
    verxioArtifactPreviewTarget.mockResolvedValue(null)
    // @ts-expect-error test stub
    window.hermesDesktop = {
      readFileDataUrl: vi.fn(async () => {
        throw new Error('File preview is not available in Verxio Web yet.')
      })
    }
  })

  it('returns remote https URLs unchanged', async () => {
    await expect(resolveMediaPlaybackSrc('https://cdn.example/clip.mp4')).resolves.toBe('https://cdn.example/clip.mp4')
  })

  it('uses the artifacts preview URL for web audio instead of hermes-media://', async () => {
    verxioArtifactPreviewTarget.mockResolvedValue({
      kind: 'url',
      label: 'hello.mp3',
      mimeType: 'audio/mpeg',
      previewKind: 'binary',
      source: '/workspace/artifacts/hello.mp3',
      url: '/api/artifacts/art_audio/preview'
    })

    await expect(resolveMediaPlaybackSrc('/workspace/artifacts/hello.mp3')).resolves.toBe(
      '/api/artifacts/art_audio/preview'
    )
    expect(window.hermesDesktop?.readFileDataUrl).not.toHaveBeenCalled()
  })

  it('uses the artifacts preview URL for web video instead of hermes-media://', async () => {
    verxioArtifactPreviewTarget.mockResolvedValue({
      kind: 'url',
      label: 'clip.mp4',
      mimeType: 'video/mp4',
      previewKind: 'binary',
      source: '/workspace/artifacts/clip.mp4',
      url: '/api/artifacts/art_video/preview'
    })

    await expect(resolveMediaPlaybackSrc('/workspace/artifacts/clip.mp4')).resolves.toBe(
      '/api/artifacts/art_video/preview'
    )
  })

  it('streams audio/video through hermes-media on desktop only', async () => {
    isVerxioDesktop.mockReturnValue(true)
    isVerxioWeb.mockReturnValue(false)

    await expect(resolveMediaPlaybackSrc('/tmp/voice.mp3')).resolves.toBe(
      `hermes-media://stream/${encodeURIComponent('/tmp/voice.mp3')}`
    )
    expect(verxioArtifactPreviewTarget).not.toHaveBeenCalled()
  })
})
