import { resolveDesktopWorkspaceCwd } from '@/lib/desktop-workspace'

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

  const bare = raw.replace(/^\.\//, '')

  if (bare.startsWith('artifacts/')) {
    return bare.slice('artifacts/'.length)
  }

  return null
}

/** Absolute files to try when a chat mentions an artifact the API has not indexed. */
export function desktopArtifactCandidates(path: string, workspaceRoot?: string | null, cwd?: string | null): string[] {
  const candidates: string[] = []

  const add = (value?: string | null) => {
    const trimmed = value?.trim()

    if (!trimmed?.startsWith('/') || candidates.includes(trimmed)) {
      return
    }

    candidates.push(trimmed)
  }

  add(path)

  const root = workspaceRoot?.trim() || cwd?.trim() || null

  if (root) {
    add(resolveDesktopWorkspaceCwd(path, root))
  }

  const relative = workspaceArtifactRelativePath(path)

  for (const base of [cwd, workspaceRoot]) {
    const trimmed = base?.trim()

    if (!trimmed || !relative) {
      continue
    }

    const localBase = resolveDesktopWorkspaceCwd(trimmed, root) || trimmed

    add(`${localBase.replace(/\/+$/, '')}/artifacts/${relative}`)
  }

  return candidates
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
