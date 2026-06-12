import { isWebLocalPath, readWebLocalDir, readWebLocalFileText } from './web-local-fs'

const REFERENCE_RE =
  /@(?:(?:file|folder):(?:`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)|(?:diff|staged)\b|(?:git|url):(?:`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+))/g

const TRAILING_PUNCTUATION_RE = /[,.;!?]+$/

interface ParsedRef {
  raw: string
  kind: string
  target: string
  start: number
  end: number
  lineStart: number | null
  lineEnd: number | null
}

function unwrapRefValue(raw: string): string {
  if (raw.length < 2) {
    return raw
  }

  const head = raw[0]
  const tail = raw[raw.length - 1]

  if ((head === '`' && tail === '`') || (head === '"' && tail === '"') || (head === "'" && tail === "'")) {
    return raw.slice(1, -1)
  }

  return raw
}

function joinWebLocalPath(root: string, rel: string): string {
  const base = root.replace(/\/+$/, '')
  const clean = rel.replace(/^\.\//, '').replace(/\/+$/, '')

  if (!clean || clean === '.') {
    return base
  }

  return `${base}/${clean}`
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function parseFileTarget(value: string): { target: string; lineStart: number | null; lineEnd: number | null } {
  const colon = value.lastIndexOf(':')

  if (colon <= 0 || !/^\d+(-\d+)?$/.test(value.slice(colon + 1))) {
    return { target: value, lineStart: null, lineEnd: null }
  }

  const target = value.slice(0, colon)
  const range = value.slice(colon + 1)
  const [startRaw, endRaw] = range.split('-')
  const lineStart = Number(startRaw)
  const lineEnd = endRaw ? Number(endRaw) : lineStart

  return { target, lineStart, lineEnd }
}

function parseReferences(message: string): ParsedRef[] {
  const refs: ParsedRef[] = []

  for (const match of message.matchAll(REFERENCE_RE)) {
    const raw = match[0]
    const start = match.index ?? 0
    const end = start + raw.length

    if (raw === '@diff' || raw === '@staged') {
      refs.push({ raw, kind: raw.slice(1), target: '', start, end, lineStart: null, lineEnd: null })

      continue
    }

    const kindMatch = /^@(file|folder|git|url):(.+)$/.exec(raw)

    if (!kindMatch) {
      continue
    }

    const [, kind, rawValue] = kindMatch
    const value = unwrapRefValue(rawValue.replace(TRAILING_PUNCTUATION_RE, ''))

    if (kind === 'file') {
      const parsed = parseFileTarget(value)
      refs.push({
        raw,
        kind,
        target: parsed.target,
        start,
        end,
        lineStart: parsed.lineStart,
        lineEnd: parsed.lineEnd
      })

      continue
    }

    refs.push({ raw, kind, target: value, start, end, lineStart: null, lineEnd: null })
  }

  return refs
}

function removeReferenceTokens(message: string, refs: readonly ParsedRef[]): string {
  const pieces: string[] = []
  let cursor = 0

  for (const ref of refs) {
    pieces.push(message.slice(cursor, ref.start))
    cursor = ref.end
  }

  pieces.push(message.slice(cursor))

  return pieces
    .join('')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function codeFenceLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''

  return ext || 'text'
}

async function expandFileRef(ref: ParsedRef, cwd: string): Promise<{ warning?: string; block?: string }> {
  const fullPath = joinWebLocalPath(cwd, ref.target)
  const result = await readWebLocalFileText(fullPath)

  if (!result) {
    return { warning: `${ref.raw}: file not found` }
  }

  if (result.binary) {
    return { warning: `${ref.raw}: binary files are not supported` }
  }

  let text = result.text

  if (ref.lineStart !== null) {
    const lines = text.split('\n')
    const startIdx = Math.max(ref.lineStart - 1, 0)
    const endIdx = Math.min(ref.lineEnd ?? ref.lineStart, lines.length)
    text = lines.slice(startIdx, endIdx).join('\n')
  }

  const lang = codeFenceLanguage(ref.target)

  return {
    block: `📄 ${ref.raw} (${estimateTokens(text)} tokens)\n\`\`\`${lang}\n${text}\n\`\`\``
  }
}

async function collectFolderEntries(dirPath: string, relPrefix: string, limit: number, lines: string[]): Promise<void> {
  if (lines.length >= limit) {
    return
  }

  const result = await readWebLocalDir(dirPath)

  for (const entry of result.entries) {
    if (lines.length >= limit) {
      return
    }

    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
    const indent = '  '.repeat(relPrefix ? relPrefix.split('/').length : 0)

    if (entry.isDirectory) {
      lines.push(`${indent}- ${entry.name}/`)
      await collectFolderEntries(entry.path, rel, limit, lines)
    } else {
      const file = await readWebLocalFileText(entry.path)
      const meta = file?.binary ? 'binary' : `${(file?.text || '').split('\n').length} lines`
      lines.push(`${indent}- ${entry.name} (${meta})`)
    }
  }
}

async function expandFolderRef(ref: ParsedRef, cwd: string): Promise<{ warning?: string; block?: string }> {
  const fullPath = joinWebLocalPath(cwd, ref.target)
  const rootListing = await readWebLocalDir(fullPath)

  if (rootListing.error) {
    return { warning: `${ref.raw}: folder not found` }
  }

  const lines = [`${ref.target.replace(/\/+$/, '')}/`]
  await collectFolderEntries(fullPath, ref.target.replace(/\/+$/, ''), 200, lines)

  if (lines.length >= 200) {
    lines.push('- ...')
  }

  const listing = lines.join('\n')

  return {
    block: `📁 ${ref.raw} (${estimateTokens(listing)} tokens)\n${listing}`
  }
}

/** Expand `@file` / `@folder` references from a browser-granted folder before sending to the gateway. */
export async function preprocessWebLocalContextReferences(message: string, cwd: string): Promise<string> {
  if (!isWebLocalPath(cwd) || !message.includes('@')) {
    return message
  }

  const refs = parseReferences(message).filter(ref => ref.kind === 'file' || ref.kind === 'folder')

  if (!refs.length) {
    return message
  }

  const warnings: string[] = []
  const blocks: string[] = []

  for (const ref of refs) {
    const expanded = ref.kind === 'file' ? await expandFileRef(ref, cwd) : await expandFolderRef(ref, cwd)

    if (expanded.warning) {
      warnings.push(expanded.warning)
    }

    if (expanded.block) {
      blocks.push(expanded.block)
    }
  }

  let final = removeReferenceTokens(message, refs)

  if (warnings.length) {
    final = `${final}\n\n--- Context Warnings ---\n${warnings.map(w => `- ${w}`).join('\n')}`
  }

  if (blocks.length) {
    final = `${final}\n\n--- Attached Context ---\n\n${blocks.join('\n\n')}`
  }

  return final.trim()
}
