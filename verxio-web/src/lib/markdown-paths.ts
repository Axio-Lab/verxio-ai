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
