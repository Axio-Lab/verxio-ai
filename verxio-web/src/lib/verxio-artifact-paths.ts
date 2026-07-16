const ARTIFACT_PATH_RE =
  /(?:\/workspace\/artifacts\/|\/artifacts\/|artifacts\/)[^\s<>"'()[\]{}]+?\.[a-z0-9]{1,8}(?:\?[^,\s<>"'()[\]{}]*)?/gi

export function workspaceArtifactRelativePath(path: string): string | null {
  const raw = path
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/[.,;:!?]+$/g, '')

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

    if (!workspaceArtifactRelativePath(path) || seen.has(path)) {
      continue
    }

    seen.add(path)
    paths.push(path)
  }

  return paths
}
