import type { PreviewTarget } from '@/store/preview'

import {
  getDesktopWorkspaceRoot,
  isRuntimeWorkspacePath,
  isVerxioDesktop,
  resolveDesktopWorkspaceCwd
} from './desktop-workspace'
import { workspaceArtifactRelativePath } from './verxio-artifact-paths'
import { verxioArtifactPreviewTarget } from './verxio-artifact-preview'

const HTML_EXTENSIONS = new Set(['.htm', '.html'])
const IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.c': 'c',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.css': 'css',
  '.csv': 'csv',
  '.go': 'go',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.log': 'text',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shell',
  '.sql': 'sql',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': 'text',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell'
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() || value
}

function extension(value: string) {
  const clean = value.split(/[?#]/, 1)[0] || value
  const idx = clean.lastIndexOf('.')

  return idx >= 0 ? clean.slice(idx).toLowerCase() : ''
}

function joinPath(base: string, rel: string) {
  if (!base) {
    return rel
  }

  return `${base.replace(/\/+$/, '')}/${rel.replace(/^\.?\//, '')}`
}

function pathToFileUrl(path: string) {
  const encoded = path
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')

  return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`
}

function looksLikeLocalhostUrl(raw: string): boolean {
  return /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$|\?|#)/i.test(raw)
}

export function localPreviewTarget(rawTarget: string, cwd?: string | null): PreviewTarget | null {
  let raw = rawTarget.trim().replace(/^`|`$/g, '')

  if (!raw) {
    return null
  }

  if (isVerxioDesktop() && isRuntimeWorkspacePath(raw)) {
    raw = resolveDesktopWorkspaceCwd(raw, getDesktopWorkspaceRoot()) ?? raw
  }

  if (/^https?:\/\//i.test(raw)) {
    return { kind: 'url', label: basename(raw), source: raw, url: raw }
  }

  // Tool rows often record bare "localhost:5173" / "localhost:8080".
  if (looksLikeLocalhostUrl(raw)) {
    return { kind: 'url', label: basename(raw), source: raw, url: `http://${raw}` }
  }

  let path = raw

  if (/^file:\/\//i.test(raw)) {
    try {
      path = decodeURIComponent(new URL(raw).pathname)
    } catch {
      path = raw.replace(/^file:\/\//i, '')
    }
  } else if (!raw.startsWith('/') && cwd) {
    const resolvedCwd =
      isVerxioDesktop() && isRuntimeWorkspacePath(cwd)
        ? (resolveDesktopWorkspaceCwd(cwd, getDesktopWorkspaceRoot()) ?? cwd)
        : cwd

    path = joinPath(resolvedCwd, raw)
  } else if (isVerxioDesktop() && !raw.startsWith('/') && isRuntimeWorkspacePath(raw)) {
    path = resolveDesktopWorkspaceCwd(raw, getDesktopWorkspaceRoot()) ?? raw
  }

  const ext = extension(path)
  const isHtml = HTML_EXTENSIONS.has(ext)
  const isImage = IMAGE_EXTENSIONS.has(ext)

  return {
    kind: 'file',
    label: basename(path),
    language: LANGUAGE_BY_EXT[ext] || 'text',
    path,
    // Renderer fallback can't stat/sniff without reading; assume text unless
    // image/html extension says otherwise. LocalFilePreview still guards
    // binary/large files when readFileText/readFileDataUrl returns metadata.
    previewKind: isHtml ? 'html' : isImage ? 'image' : 'text',
    source: raw,
    url: pathToFileUrl(path)
  }
}

/**
 * Resolve a preview target for both Verxio Desktop and hosted web.
 *
 * Priority:
 * 1. Desktop IPC normalize (real local files)
 * 2. Desktop local `/workspace` → user folder mapping
 * 3. Hosted Verxio `/api/artifacts/.../preview` for workspace artifacts
 * 4. Generic local/http classification
 */
export async function normalizeOrLocalPreviewTarget(
  rawTarget: string,
  cwd?: string | null
): Promise<PreviewTarget | null> {
  try {
    const normalized = await window.hermesDesktop?.normalizePreviewTarget?.(rawTarget, cwd || undefined)

    if (normalized) {
      return normalized
    }
  } catch {
    // Running Electron may still have the old HTML-only preview IPC. Fall
    // through to renderer-side local classification so text/images still open.
  }

  // Desktop: prefer the on-device workspace file for the right-rail preview pane.
  // Do this before the artifacts API so a slow/unavailable API cannot block local preview.
  if (isVerxioDesktop()) {
    const desktopLocal = localPreviewTarget(rawTarget, cwd)

    if (desktopLocal) {
      const mappedPath = desktopLocal.path || ''

      // Mapped off `/workspace` onto a real host path, or already a local/http URL.
      if (desktopLocal.kind === 'url' || (mappedPath && !isRuntimeWorkspacePath(mappedPath))) {
        return desktopLocal
      }
    }
  }

  // Web (and desktop fallback): resolve workspace artifacts through the API.
  try {
    const verxioTarget = await verxioArtifactPreviewTarget(rawTarget)

    if (verxioTarget) {
      return verxioTarget
    }
  } catch {
    // Artifacts API may be briefly unavailable; fall through to local target.
  }

  const local = localPreviewTarget(rawTarget, cwd)

  // Never hand hosted web a container file:// URL for /workspace/artifacts — the
  // browser blocks it and the status-stack "Open preview" looked broken.
  if (!isVerxioDesktop() && local?.url.startsWith('file:') && workspaceArtifactRelativePath(rawTarget)) {
    return null
  }

  return local
}
