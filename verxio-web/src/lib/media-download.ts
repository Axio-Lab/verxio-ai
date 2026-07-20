import { mediaName } from '@/lib/media'
import { verxioApiUrl } from '@/lib/verxio-api'
import { verxioArtifactPreviewTarget } from '@/lib/verxio-artifact-preview'

export function mediaFilename(src?: string): string {
  if (!src) {
    return 'download'
  }

  try {
    const { pathname } = new URL(src, window.location.href)
    const leaf = pathname.split('/').filter(Boolean).pop() || 'download'

    // `/api/artifacts/{id}/preview|download` — prefer a stable generic name; the
    // Content-Disposition header usually supplies the real filename on fetch.
    if (leaf === 'preview' || leaf === 'download') {
      return 'download'
    }

    return leaf
  } catch {
    return mediaName(src) || 'download'
  }
}

/** Map an artifacts preview URL to the attachment download endpoint. */
export function artifactDownloadUrlFromSrc(src: string): string | null {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost'
    const url = new URL(src, base)
    const match = url.pathname.match(/\/api\/artifacts\/([^/]+)\/(?:preview|download)\/?$/i)

    if (!match?.[1]) {
      return null
    }

    const path = `/api/artifacts/${encodeURIComponent(match[1])}/download${url.search}`

    // Keep relative inputs relative so same-origin fetch stays on the web origin.
    if (/^https?:\/\//i.test(src.trim())) {
      return `${url.origin}${path}`
    }

    return path
  } catch {
    return null
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null
  }

  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1]

  if (utf8) {
    try {
      return decodeURIComponent(utf8.trim())
    } catch {
      return utf8.trim()
    }
  }

  const plain = header.match(/filename="?([^";]+)"?/i)?.[1]

  return plain?.trim() || null
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
}

async function fetchAndDownload(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url, { credentials: 'include' })

  if (!response.ok) {
    throw new Error(`Could not download file: ${response.status}`)
  }

  const filename = filenameFromContentDisposition(response.headers.get('content-disposition')) || fallbackName
  triggerBlobDownload(await response.blob(), filename)
}

/**
 * Download a media URL in the browser.
 * Prefers same-origin artifact `/download` endpoints (cookie auth + filename),
 * then fetch+blob, then a plain navigation fallback for cross-origin URLs.
 */
export async function startBrowserDownload(src: string): Promise<void> {
  const preferred = artifactDownloadUrlFromSrc(src) ?? src
  const fallbackName = mediaFilename(preferred === src ? src : preferred)

  try {
    await fetchAndDownload(preferred, fallbackName)

    return
  } catch (error) {
    if (preferred !== src) {
      throw error
    }
  }

  // Cross-origin remote URLs often block fetch (CORS). Last resort: open the
  // resource; the browser may still offer Save depending on Content-Disposition.
  const link = document.createElement('a')
  link.href = src
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.download = fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Resolve a workspace/local path to a same-origin artifact download URL. */
export async function artifactDownloadUrlFromPath(path: string): Promise<string | null> {
  const preview = await verxioArtifactPreviewTarget(path)

  if (!preview?.url) {
    return null
  }

  return artifactDownloadUrlFromSrc(preview.url) ?? verxioApiUrl(preview.url.replace(/\/preview\/?$/i, '/download'))
}

/**
 * Download from the first working candidate (display URL, host path, remote URL).
 */
export async function downloadMediaFromCandidates(candidates: readonly string[]): Promise<string> {
  const unique = [...new Set(candidates.filter(Boolean))]
  let lastError: unknown

  for (const candidate of unique) {
    try {
      if (/^(?:https?|data|blob):/i.test(candidate) || candidate.startsWith('/api/')) {
        await startBrowserDownload(candidate)

        return mediaFilename(candidate)
      }

      const artifactDownload = await artifactDownloadUrlFromPath(candidate)

      if (artifactDownload) {
        await startBrowserDownload(artifactDownload)

        return mediaFilename(artifactDownload)
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Download failed')
}
