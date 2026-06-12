import type { CompletionEntry } from '@/app/chat/composer/hooks/use-live-completion-adapter'

import { isWebLocalPath, readWebLocalDir } from './web-local-fs'

const FUZZY_EXCLUDES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  '.ruff_cache'
])

function joinWebLocalPath(root: string, rel: string): string {
  const base = root.replace(/\/+$/, '')
  const clean = rel.replace(/^\.\//, '').replace(/\/+$/, '')

  if (!clean || clean === '.') {
    return base
  }

  return `${base}/${clean}`
}

function dirname(rel: string): string {
  const normalized = rel.replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')

  if (slash === -1) {
    return '.'
  }

  return normalized.slice(0, slash) || '.'
}

function basename(rel: string): string {
  const normalized = rel.replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')

  return slash === -1 ? normalized : normalized.slice(slash + 1)
}

function fuzzyBasenameRank(name: string, query: string): [number, number] | null {
  if (!query) {
    return [3, name.length]
  }

  const nl = name.toLowerCase()
  const ql = query.toLowerCase()

  if (nl === ql) {
    return [0, name.length]
  }

  if (nl.startsWith(ql)) {
    return [1, name.length]
  }

  if (nl.includes(ql)) {
    return [3, name.length]
  }

  let i = 0

  for (const ch of nl) {
    if (ch === ql[i]) {
      i += 1

      if (i === ql.length) {
        return [4, name.length]
      }
    }
  }

  return null
}

async function collectRelativeFiles(rootCwd: string, maxFiles = 500): Promise<string[]> {
  const files: string[] = []
  const root = rootCwd.replace(/\/+$/, '')

  async function walk(dirPath: string, relPrefix: string): Promise<void> {
    if (files.length >= maxFiles) {
      return
    }

    const result = await readWebLocalDir(dirPath)

    for (const entry of result.entries) {
      if (files.length >= maxFiles) {
        return
      }

      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name

      if (entry.isDirectory) {
        if (FUZZY_EXCLUDES.has(entry.name)) {
          continue
        }

        await walk(entry.path, rel)
      } else {
        files.push(rel)
      }
    }
  }

  await walk(root, '')

  return files
}

/** Client-side `@file` / `@folder` completions for browser-granted folders. */
export async function completeWebLocalPath(word: string, rootCwd: string): Promise<CompletionEntry[]> {
  if (!isWebLocalPath(rootCwd)) {
    return []
  }

  const isContext = word.startsWith('@')
  const query = isContext ? word.slice(1) : word

  if (isContext && !query) {
    return [
      { text: '@file:', display: '@file:', meta: 'attach file' },
      { text: '@folder:', display: '@folder:', meta: 'attach folder' }
    ]
  }

  let prefixTag = ''
  let pathPart = ''

  if (isContext && (query === 'file' || query === 'folder')) {
    prefixTag = query
    pathPart = ''
  } else if (isContext && (query.startsWith('file:') || query.startsWith('folder:'))) {
    const split = query.indexOf(':')
    prefixTag = query.slice(0, split)
    pathPart = query.slice(split + 1)
  } else if (isContext) {
    pathPart = query
  } else {
    pathPart = query
  }

  if (isContext && pathPart && pathPart.length >= 2 && !pathPart.includes('/') && prefixTag !== 'folder') {
    const ranked: Array<{ rank: [number, number]; rel: string; basename: string }> = []

    for (const rel of await collectRelativeFiles(rootCwd)) {
      const name = basename(rel)

      if (name.startsWith('.') && !pathPart.startsWith('.')) {
        continue
      }

      const rank = fuzzyBasenameRank(name, pathPart)

      if (!rank) {
        continue
      }

      ranked.push({ rank, rel, basename: name })
    }

    ranked.sort(
      (left, right) =>
        left.rank[0] - right.rank[0] || left.rel.length - right.rel.length || left.rel.localeCompare(right.rel)
    )

    const tag = prefixTag || 'file'

    return ranked.slice(0, 30).map(item => ({
      text: `@${tag}:${item.rel}`,
      display: item.basename,
      meta: dirname(item.rel)
    }))
  }

  const expanded = pathPart || '.'
  let searchDir = '.'
  let match = ''

  if (expanded === '.' || !expanded) {
    searchDir = '.'
    match = ''
  } else if (expanded.endsWith('/')) {
    searchDir = expanded
    match = ''
  } else {
    searchDir = dirname(expanded)
    match = basename(expanded)
  }

  const searchPath = joinWebLocalPath(rootCwd, searchDir)
  const listing = await readWebLocalDir(searchPath)

  if (listing.error) {
    return []
  }

  const wantDir = prefixTag === 'folder'
  const matchLower = match.toLowerCase()
  const items: CompletionEntry[] = []

  for (const entry of listing.entries) {
    if (match && !entry.name.toLowerCase().startsWith(matchLower)) {
      continue
    }

    if (entry.isDirectory !== wantDir && prefixTag) {
      continue
    }

    const relDir = searchDir === '.' ? '' : searchDir.replace(/\/+$/, '')
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name
    const suffix = entry.isDirectory ? '/' : ''
    const tag = prefixTag || (entry.isDirectory ? 'folder' : 'file')

    items.push({
      text: `@${tag}:${rel}${suffix}`,
      display: `${entry.name}${suffix}`,
      meta: entry.isDirectory ? 'dir' : ''
    })

    if (items.length >= 30) {
      break
    }
  }

  return items
}
