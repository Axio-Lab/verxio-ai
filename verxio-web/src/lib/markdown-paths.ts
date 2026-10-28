import { previewMarkdownHref } from '@/lib/preview-targets'

export const FILE_PATH_EXT_RE =
  /\.(?:md|markdown|json|jsonc|html?|py|ts|tsx|js|jsx|mjs|cjs|css|scss|less|yaml|yml|toml|txt|csv|xml|sql|sh|bash|zsh|go|rs|rb|java|kt|swift|php|png|jpe?g|gif|webp|svg|bmp|pdf|zip|tar|gz|wasm|vue|svelte)(?:\?.*)?$/i

// Match workspace / artifacts / relative paths with a file extension.
const FILE_PATH_AUTOLINK_RE =
  /(^|[\s(])((?:\/(?:workspace|artifacts)?\/|~\/|(?:\.\.?\/))[^\s<>"']+?(?:\.[a-z0-9]{1,8})?)(?=[\s.,;:!?)}\]'"]|$)/gi

export function looksLikeFilePath(value: string): boolean {
  const raw = value.trim().replace(/^`|`$/g, '')

  if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith('#')) {
    return false
  }

  if (/^file:\/\//i.test(raw)) {
    return true
  }

  if (!/^(?:\/|~\/|(?:\.\.?\/)).+/.test(raw) || /\s/.test(raw)) {
    return false
  }

  return FILE_PATH_EXT_RE.test(raw) || raw.split(/[\\/]/).filter(Boolean).length >= 2
}

export function autoLinkFilePaths(text: string): string {
  return text.replace(FILE_PATH_AUTOLINK_RE, (match, lead: string, path: string) => {
    if (!looksLikeFilePath(path)) {
      return match
    }

    return `${lead}[${path}](${previewMarkdownHref(path)})`
  })
}

const MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g

function bareWorkspaceHref(href: string): string | null {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) {
    return null
  }

  if (href.startsWith('/') || href.startsWith('~/') || href.startsWith('../')) {
    return null
  }

  const relative = href.replace(/^\.\//, '')

  if (!relative || relative.startsWith('../') || relative.split('/')[0]?.includes('.')) {
    return null
  }

  if (!FILE_PATH_EXT_RE.test(relative)) {
    return null
  }

  return `/workspace/${relative}`
}

// Streamdown's link hardener drops destinations like `artifacts/report.html`
// (no scheme, and not `/`, `./`, or `../`) and renders them as `[blocked]`.
// `/workspace/...` is a path this app already opens.
export function anchorBareFileLinks(text: string): string {
  return text.replace(MARKDOWN_LINK_RE, (match, label: string, href: string) => {
    const workspaceHref = bareWorkspaceHref(href)

    if (!workspaceHref) {
      return match
    }

    return `[${label}](${workspaceHref})`
  })
}
