// Match a full artifact path token, then require a letter-led extension so
// timestamped names like `0.00-verxio.png` are not truncated at `.00`.
const ARTIFACT_PATH_RE = /(?:\/workspace\/artifacts\/|\/artifacts\/|artifacts\/)[^\s<>"'()[\]{}]+/gi
const ARTIFACT_EXTENSION_RE = /\.[a-zA-Z][a-zA-Z0-9]{0,7}(?:\?[^,\s<>"'()[\]{}]*)?$/

export function workspaceArtifactRelativePath(path: string): string | null {
  let raw = path
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/[.,;:!?]+$/g, '')

  // Status-stack / desktop helpers sometimes pass file:// workspace URLs.
  if (/^file:\/\//i.test(raw)) {
    try {
      raw = decodeURIComponent(new URL(raw).pathname)
    } catch {
      raw = raw.replace(/^file:\/\//i, '')
    }
  }

  if (raw.startsWith('/workspace/artifacts/')) {
    return raw.slice('/workspace/artifacts/'.length)
  }

  if (raw.startsWith('/artifacts/')) {
    return raw.slice('/artifacts/'.length)
  }

  if (raw.startsWith('artifacts/')) {
    return raw.slice('artifacts/'.length)
  }

  return null
}

export function extractWorkspaceArtifactPaths(text: string): string[] {
  const seen = new Set<string>()
  const paths: string[] = []

  for (const match of text.matchAll(ARTIFACT_PATH_RE)) {
    const path = match[0].replace(/[.,;:!?]+$/g, '')

    if (!ARTIFACT_EXTENSION_RE.test(path) || !workspaceArtifactRelativePath(path) || seen.has(path)) {
      continue
    }

    seen.add(path)
    paths.push(path)
  }

  return paths
}
