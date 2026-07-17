import { listVerxioArtifacts, verxioApiEnabled, verxioApiUrl, type VerxioArtifact } from '@/lib/verxio-api'
import { workspaceArtifactRelativePath } from '@/lib/verxio-artifact-paths'
import type { PreviewTarget } from '@/store/preview'

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() || value
}

export function artifactPreviewKind(record: VerxioArtifact): PreviewTarget['previewKind'] {
  const mime = (record.content_type || '').toLowerCase()
  const name = (record.file_name || record.relative_path || '').toLowerCase()

  if (mime.startsWith('image/') || /\.(bmp|gif|jpe?g|png|svg|webp)$/.test(name)) {
    return 'image'
  }

  if (mime.includes('html') || /\.html?$/.test(name)) {
    return 'html'
  }

  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('javascript') ||
    mime.includes('xml') ||
    /\.(css|csv|js|json|jsx|md|mjs|py|rs|sh|sql|toml|ts|tsx|txt|xml|ya?ml)$/.test(name)
  ) {
    return 'text'
  }

  return 'binary'
}

export function recordMatchesArtifactPath(record: VerxioArtifact, path: string): boolean {
  const relative = workspaceArtifactRelativePath(path)?.replace(/^\/+/, '')

  if (!relative) {
    return false
  }

  const artifactPath = record.relative_path.replace(/^workspace\//, '')
  const runtimeHomePath = record.relative_path.replace(/^runtime-home\/artifacts\//, '')
  const fileName = relative.split('/').filter(Boolean).pop() || relative

  return (
    artifactPath === relative ||
    runtimeHomePath === relative ||
    record.file_name === fileName ||
    artifactPath.endsWith(`/${fileName}`) ||
    runtimeHomePath.endsWith(`/${fileName}`)
  )
}

/** Resolve a workspace artifact path to a same-origin Verxio preview URL for hosted web. */
export async function verxioArtifactPreviewTarget(path: string): Promise<PreviewTarget | null> {
  if (!verxioApiEnabled()) {
    return null
  }

  if (!workspaceArtifactRelativePath(path)) {
    return null
  }

  const response = await listVerxioArtifacts()
  const record = response.artifacts.find(artifact => recordMatchesArtifactPath(artifact, path))

  if (!record) {
    return null
  }

  return artifactTargetForRecord(record, path)
}

export function artifactTargetForRecord(record: VerxioArtifact, path: string): PreviewTarget {
  return {
    kind: 'url',
    label: record.file_name || basename(path),
    mimeType: record.content_type,
    previewKind: artifactPreviewKind(record),
    source: path,
    url: verxioApiUrl(`/api/artifacts/${encodeURIComponent(record.id)}/preview`)
  }
}
