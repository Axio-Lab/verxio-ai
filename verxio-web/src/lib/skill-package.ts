import JSZip from 'jszip'

/** Supporting skill dirs allowed by Hermes ``skill_manage write_file``. */
export const SKILL_SUPPORT_DIRS = ['references', 'templates', 'scripts', 'assets'] as const

export type SkillSupportDir = (typeof SKILL_SUPPORT_DIRS)[number]

export type ExtractedSkillFile = {
  path: string
  content: string
}

export type ExtractedSkillPackage = {
  name: string
  content: string
  /** Always defaults to custom for user-imported packages. */
  category: string
  files: ExtractedSkillFile[]
  skippedBinary: string[]
}

const TEXT_EXT =
  /\.(md|txt|json|ya?ml|toml|py|js|ts|tsx|jsx|mjs|cjs|sh|bash|zsh|css|html|svg|csv|tsv|env|ini|cfg|conf|xml|rst|r|go|rs|java|kt|swift|rb|php|sql|graphql|dockerfile)$/i

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function basename(path: string): string {
  const parts = normalizeSlashes(path).split('/').filter(Boolean)

  return parts[parts.length - 1] ?? ''
}

function dirname(path: string): string {
  const parts = normalizeSlashes(path).split('/').filter(Boolean)
  parts.pop()

  return parts.join('/')
}

function parseFrontmatterName(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)

  if (!match) {
    return null
  }

  const nameLine = match[1].match(/^\s*name\s*:\s*["']?([^"'\n#]+?)["']?\s*$/m)
  const raw = nameLine?.[1]?.trim()

  if (!raw) {
    return null
  }

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function isLikelyText(path: string, bytes: Uint8Array): boolean {
  if (TEXT_EXT.test(path) || basename(path).toLowerCase() === 'skill.md') {
    return true
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 800))
  let weird = 0

  for (const b of sample) {
    if (b === 0) {
      return false
    }

    if (b < 7 || (b > 14 && b < 32)) {
      weird += 1
    }
  }

  return weird / Math.max(sample.length, 1) < 0.05
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function supportRelativePath(entryPath: string, skillRoot: string): string | null {
  const full = normalizeSlashes(entryPath).replace(/^\.\//, '')
  const root = skillRoot ? `${skillRoot}/` : ''

  if (root && !full.startsWith(root)) {
    return null
  }

  const relative = root ? full.slice(root.length) : full
  const top = relative.split('/')[0]

  if (!SKILL_SUPPORT_DIRS.includes(top as SkillSupportDir)) {
    return null
  }

  if (relative.includes('..')) {
    return null
  }

  return relative
}

function findSkillMdEntries(paths: string[]): { skillMd: string; skillRoot: string } | null {
  const normalized = paths.map(normalizeSlashes)
  const exact = normalized.find(p => basename(p).toLowerCase() === 'skill.md' && !p.endsWith('/'))

  if (!exact) {
    return null
  }

  // Prefer shallowest SKILL.md (package root over nested copies).
  const candidates = normalized
    .filter(p => basename(p).toLowerCase() === 'skill.md' && !p.endsWith('/'))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))

  const skillMd = candidates[0]

  return { skillMd, skillRoot: dirname(skillMd) }
}

async function extractFromZip(file: File): Promise<ExtractedSkillPackage> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const paths = Object.keys(zip.files).filter(p => !zip.files[p]?.dir)
  const found = findSkillMdEntries(paths)

  if (!found) {
    throw new Error('No SKILL.md found in the zip. Export a skill folder that includes SKILL.md.')
  }

  const skillEntry = zip.files[found.skillMd]

  if (!skillEntry) {
    throw new Error('Could not read SKILL.md from the zip.')
  }

  const content = await skillEntry.async('string')

  if (!content.trim()) {
    throw new Error('SKILL.md is empty.')
  }

  const files: ExtractedSkillFile[] = []
  const skippedBinary: string[] = []

  for (const path of paths) {
    const relative = supportRelativePath(path, found.skillRoot)

    if (!relative) {
      continue
    }

    const entry = zip.files[path]

    if (!entry || entry.dir) {
      continue
    }

    const bytes = await entry.async('uint8array')

    if (!isLikelyText(path, bytes)) {
      skippedBinary.push(relative)

      continue
    }

    files.push({ path: relative, content: decodeUtf8(bytes) })
  }

  const folderHint = found.skillRoot.split('/').filter(Boolean).pop() || ''
  const name =
    parseFrontmatterName(content) || folderHint.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase() || 'imported-skill'

  return {
    name,
    content,
    category: 'custom',
    files,
    skippedBinary
  }
}

async function extractFromSkillMd(file: File): Promise<ExtractedSkillPackage> {
  const content = await file.text()

  if (!content.trim()) {
    throw new Error('SKILL.md is empty.')
  }

  const stem = file.name
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .toLowerCase()
  const name = parseFrontmatterName(content) || stem || 'imported-skill'

  return {
    name,
    content,
    category: 'custom',
    files: [],
    skippedBinary: []
  }
}

/** Unpack a local skill zip or SKILL.md in the browser — no server upload of the archive. */
export async function extractSkillPackage(file: File): Promise<ExtractedSkillPackage> {
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.zip')) {
    return extractFromZip(file)
  }

  if (lower.endsWith('.md') || lower === 'skill.md' || basename(file.name).toLowerCase() === 'skill.md') {
    return extractFromSkillMd(file)
  }

  throw new Error('Choose a .zip skill package or a SKILL.md file.')
}
