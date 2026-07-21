import { filePathFromMediaPath, mediaExternalUrl, mediaKind, mediaStreamUrl } from '@/lib/media'
import { isVerxioDesktop, isVerxioWeb } from '@/lib/platform'
import { verxioArtifactPreviewTarget } from '@/lib/verxio-artifact-preview'

function isInlineSrc(path: string): boolean {
  return /^(?:https?|data):/i.test(path)
}

/**
 * Resolve a playable/viewable URL for a MEDIA path in chat.
 *
 * Desktop streams audio/video through the Electron protocol. Hosted web must
 * use the same-origin artifacts preview API — `hermes-media://` and `file://`
 * both fail in the browser, and the old web `readFileDataUrl` stub threw.
 */
export async function resolveMediaPlaybackSrc(path: string): Promise<string> {
  if (isInlineSrc(path)) {
    return path
  }

  const kind = mediaKind(path)

  if (isVerxioDesktop() && (kind === 'audio' || kind === 'video')) {
    return mediaStreamUrl(path)
  }

  try {
    const artifact = await verxioArtifactPreviewTarget(path)

    if (artifact?.url) {
      return artifact.url
    }
  } catch {
    // Fall through to desktop / bridge readers.
  }

  if (isVerxioDesktop() && window.hermesDesktop?.readFileDataUrl) {
    return window.hermesDesktop.readFileDataUrl(filePathFromMediaPath(path))
  }

  // Web bridge can still materialize small artifact files as data URLs.
  if (isVerxioWeb() && window.hermesDesktop?.readFileDataUrl) {
    return window.hermesDesktop.readFileDataUrl(filePathFromMediaPath(path))
  }

  if (window.hermesDesktop?.readFileDataUrl) {
    return window.hermesDesktop.readFileDataUrl(filePathFromMediaPath(path))
  }

  return mediaExternalUrl(path)
}

/** Open a MEDIA path in a new tab (web artifact preview) or the OS handler. */
export async function openMediaPath(path: string): Promise<void> {
  if (isInlineSrc(path)) {
    window.open(path, '_blank', 'noopener,noreferrer')

    return
  }

  try {
    const artifact = await verxioArtifactPreviewTarget(path)

    if (artifact?.url) {
      window.open(artifact.url, '_blank', 'noopener,noreferrer')

      return
    }
  } catch {
    // Fall through.
  }

  const resolved = await resolveMediaPlaybackSrc(path)

  if (isInlineSrc(resolved) || resolved.startsWith('/api/')) {
    window.open(resolved, '_blank', 'noopener,noreferrer')

    return
  }

  await window.hermesDesktop?.openExternal(mediaExternalUrl(path))
}
