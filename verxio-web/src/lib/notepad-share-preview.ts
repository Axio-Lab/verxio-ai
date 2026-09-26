const SHARE_TOKEN_RE = /\/share\/notepad\/([^/?#\s]+)/i

export function notepadShareToken(value: string): string | null {
  const match = value.match(SHARE_TOKEN_RE)

  if (!match?.[1]) {
    return null
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/** Local API fallback writes share links at :8080. The desktop app serves that page itself. */
export function rewriteLocalNotepadShareUrl(url: string): string {
  const token = notepadShareToken(url)

  if (!token) {
    return url
  }

  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  const host = parsed.host.toLowerCase()

  if (host !== '127.0.0.1:8080' && host !== 'localhost:8080') {
    return url
  }

  if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) {
    return url
  }

  return `${window.location.origin}/share/notepad/${encodeURIComponent(token)}`
}
