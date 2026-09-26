import { atom } from 'nanostores'

import { isVerxioDesktop } from '@/lib/platform'

export { isVerxioDesktop } from '@/lib/platform'

/** Verxio runtime cwd inside Docker, not a real path on the user's machine. */
export const RUNTIME_WORKSPACE_ROOT = '/workspace'

/** Hermes home inside the hosted runtime. Same idea as `/workspace`: not a folder on the Mac. */
export const RUNTIME_HOME_ROOT = '/opt/data'

const RUNTIME_ROOTS = [RUNTIME_WORKSPACE_ROOT, RUNTIME_HOME_ROOT]

let cachedDesktopWorkspaceRoot: string | null = null

export const $desktopWorkspaceRoot = atom<string | null>(null)

function matchingRuntimeRoot(pathValue: string): string | null {
  const trimmed = pathValue.trim().replace(/\/+$/, '')

  for (const root of RUNTIME_ROOTS) {
    if (trimmed === root || trimmed.startsWith(`${root}/`)) {
      return root
    }
  }

  return null
}

export function isRuntimeWorkspacePath(pathValue: string): boolean {
  return matchingRuntimeRoot(pathValue) !== null
}

/** The bundled agent checkout is not the user's project folder. */
export function isBundledAgentCheckout(pathValue: string): boolean {
  const trimmed = pathValue.trim().replace(/[/\\]+$/, '')
  const name = trimmed.split(/[/\\]/).filter(Boolean).pop()?.toLowerCase()

  return name === 'hermes-agent'
}

export function setDesktopWorkspaceRoot(root: string | null) {
  cachedDesktopWorkspaceRoot = root?.trim() || null

  if ($desktopWorkspaceRoot.get() !== cachedDesktopWorkspaceRoot) {
    $desktopWorkspaceRoot.set(cachedDesktopWorkspaceRoot)
  }
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

  if (trimmed && isBundledAgentCheckout(trimmed)) {
    return local
  }

  const runtimeRoot = trimmed ? matchingRuntimeRoot(trimmed) : null

  if (!trimmed || runtimeRoot) {
    if (!trimmed || trimmed === runtimeRoot) {
      return local
    }

    const relative = trimmed.slice(runtimeRoot!.length + 1)

    return relative ? `${local.replace(/\/+$/, '')}/${relative}` : local
  }

  return trimmed
}

const RUNTIME_PATH_IN_TEXT_RE = /\/(?:workspace|opt\/data)(?:\/[\w./-]+)*/g

/** Replace Docker `/workspace` paths with the user's local project folder in UI copy. */
export function rewriteRuntimePathsInText(text: string): string {
  if (!isVerxioDesktop() || (!text.includes('/workspace') && !text.includes('/opt/data'))) {
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

/** Desktop chat submits the user's local folder. Cloud-agent jobs never see this path. */
export function cwdForGatewaySubmission(localCwd: string): string | undefined {
  const trimmed = localCwd.trim()

  return trimmed || undefined
}
