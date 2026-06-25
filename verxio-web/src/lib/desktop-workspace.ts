import { isVerxioDesktop } from '@/lib/platform'
import { verxioApiEnabled } from '@/lib/verxio-api'

export { isVerxioDesktop } from '@/lib/platform'

/** Hermes runtime cwd inside Docker — not a real path on the user's machine. */
export const RUNTIME_WORKSPACE_ROOT = '/workspace'

let cachedDesktopWorkspaceRoot: string | null = null

export function isRuntimeWorkspacePath(pathValue: string): boolean {
  const trimmed = pathValue.trim()

  return trimmed === RUNTIME_WORKSPACE_ROOT || trimmed.startsWith(`${RUNTIME_WORKSPACE_ROOT}/`)
}

export function setDesktopWorkspaceRoot(root: string | null) {
  cachedDesktopWorkspaceRoot = root?.trim() || null
}

export function getDesktopWorkspaceRoot(): string | null {
  return cachedDesktopWorkspaceRoot
}

/** Map Docker runtime paths to the desktop workspace folder on the user's device. */
export function resolveDesktopWorkspaceCwd(currentCwd?: string | null, localRoot?: string | null): string | null {
  const local = (localRoot ?? getDesktopWorkspaceRoot())?.trim()

  if (!local) {
    return null
  }

  const trimmed = currentCwd?.trim()

  if (!trimmed || isRuntimeWorkspacePath(trimmed)) {
    if (!trimmed || trimmed === RUNTIME_WORKSPACE_ROOT) {
      return local
    }

    const relative = trimmed.slice(RUNTIME_WORKSPACE_ROOT.length + 1)

    return relative ? `${local.replace(/\/+$/, '')}/${relative}` : local
  }

  return trimmed
}

const RUNTIME_PATH_IN_TEXT_RE = /\/workspace(?:\/[\w./-]+)*/g

/** Replace Docker `/workspace` paths with the user's local project folder in UI copy. */
export function rewriteRuntimePathsInText(text: string): string {
  if (!isVerxioDesktop() || !text.includes('/workspace')) {
    return text
  }

  return text.replace(RUNTIME_PATH_IN_TEXT_RE, match => {
    const localRoot = getDesktopWorkspaceRoot()

    // Until the local workspace root resolves (brief window on desktop boot),
    // keep the raw /workspace path: it stays a single token so autolinking
    // still fires, and clicks resolve to the local folder once the root lands.
    if (!localRoot) {
      return match
    }

    return resolveDesktopWorkspaceCwd(match, localRoot) ?? match
  })
}

/** Resolve a runtime or local path for preview/open actions on desktop. */
export function resolvePathForDesktopPreview(rawTarget: string, cwd?: string | null): string {
  const trimmed = rawTarget.trim().replace(/^`|`$/g, '')

  if (isVerxioDesktop() && isRuntimeWorkspacePath(trimmed)) {
    return resolveDesktopWorkspaceCwd(trimmed, getDesktopWorkspaceRoot()) ?? trimmed
  }

  if (isVerxioDesktop() && !trimmed.startsWith('/') && cwd && isRuntimeWorkspacePath(cwd)) {
    const localCwd = resolveDesktopWorkspaceCwd(cwd, getDesktopWorkspaceRoot())

    if (localCwd) {
      return `${localCwd.replace(/\/+$/, '')}/${trimmed.replace(/^\.?\//, '')}`
    }
  }

  return trimmed
}

/** Runtime sessions in Docker still use /workspace even though the UI browses locally. */
export function cwdForGatewaySubmission(localCwd: string): string | undefined {
  const trimmed = localCwd.trim()

  if (!isVerxioDesktop()) {
    return trimmed || undefined
  }

  if (verxioApiEnabled()) {
    return RUNTIME_WORKSPACE_ROOT
  }

  return trimmed || undefined
}
