const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const REA_PACKAGE = 'rea-agents@6.8.0'
const SKILL_NAME = 'reverse-engineer-anything'

function reaServerYaml() {
  return [
    '  rea:',
    '    command: npx',
    '    args:',
    '      - "-y"',
    `      - "${REA_PACKAGE}"`,
    '      - mcp',
    '    enabled: true',
    '    connect_timeout: 180',
    '    timeout: 300',
    '    verxio_default: true'
  ].join('\n')
}

function splitLines(text) {
  const source = String(text || '')
  if (!source) return []
  return source.split(/\r?\n/)
}

function mcpSection(lines) {
  const start = lines.findIndex(line => line === 'mcp_servers:' || line.startsWith('mcp_servers:'))
  if (start === -1) return null

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      end = index
      break
    }
  }

  return { start, end }
}

function reaBlock(lines, section) {
  const slice = lines.slice(section.start + 1, section.end)
  const offset = slice.findIndex(line => /^ {2}rea:/.test(line))
  if (offset === -1) return null

  const start = section.start + 1 + offset
  let end = section.end
  for (let index = start + 1; index < section.end; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:/.test(lines[index])) {
      end = index
      break
    }
  }

  return { start, end, text: lines.slice(start, end).join('\n') }
}

function inspectReaConfig(text) {
  const lines = splitLines(text)
  const section = mcpSection(lines)
  if (!section) return 'missing-section'

  const block = reaBlock(lines, section)
  if (!block) return 'missing'
  if (!/verxio_default:\s*true/.test(block.text)) return 'custom'
  if (/enabled:\s*(false|no|off|0)\b/.test(block.text)) return 'disabled'
  if (block.text.includes(REA_PACKAGE) && /command:\s*npx/.test(block.text)) return 'current'
  return 'outdated'
}

function renderConfig(lines) {
  const text = lines.join('\n')
  return text.endsWith('\n') || text.length === 0 ? text : `${text}\n`
}

function applyReaConfig(text) {
  const state = inspectReaConfig(text)
  if (state === 'custom' || state === 'disabled' || state === 'current') {
    return { state, text, changed: false }
  }

  const lines = splitLines(text)
  const block = reaServerYaml().split('\n')

  if (state === 'missing-section') {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('')
    lines.push('mcp_servers:', ...block)
    return { state, text: renderConfig(lines), changed: true }
  }

  const section = mcpSection(lines)
  if (state === 'missing') {
    const header = lines[section.start]
    if (header !== 'mcp_servers:') {
      lines.splice(section.start, 1, 'mcp_servers:', ...block)
    } else {
      lines.splice(section.start + 1, 0, ...block)
    }
    return { state, text: renderConfig(lines), changed: true }
  }

  const current = reaBlock(lines, section)
  lines.splice(current.start, current.end - current.start, ...block)
  return { state, text: renderConfig(lines), changed: true }
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function installReaSkill(hermesHome, sourceDir) {
  const destination = path.join(hermesHome, 'skills', 'research', SKILL_NAME)
  const skillFile = path.join(destination, 'SKILL.md')
  const stampFile = path.join(destination, '.verxio-skill-stamp')
  const sourceFile = path.join(sourceDir, 'SKILL.md')
  const sourceHash = hashFile(sourceFile)

  if (!fs.existsSync(skillFile)) {
    fs.mkdirSync(destination, { recursive: true })
    fs.writeFileSync(skillFile, fs.readFileSync(sourceFile))
    fs.writeFileSync(stampFile, `${sourceHash}\n`)
    return 'installed'
  }

  if (!fs.existsSync(stampFile)) return 'kept-user'

  const installedHash = hashFile(skillFile)
  const stamp = fs.readFileSync(stampFile, 'utf8').trim()
  if (installedHash !== stamp) return 'kept-user'
  if (installedHash === sourceHash) return 'current'

  fs.writeFileSync(skillFile, fs.readFileSync(sourceFile))
  fs.writeFileSync(stampFile, `${sourceHash}\n`)
  return 'updated'
}

function ensureReaDefault(options = {}) {
  const hermesHome = options.hermesHome
  if (!hermesHome) throw new Error('hermesHome is required')

  fs.mkdirSync(hermesHome, { recursive: true })
  const configPath = path.join(hermesHome, 'config.yaml')
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
  const applied = applyReaConfig(current)

  if (applied.changed) {
    const tmp = `${configPath}.rea.tmp`
    fs.writeFileSync(tmp, applied.text)
    fs.renameSync(tmp, configPath)
  }

  const sourceDir = options.skillDir || path.join(__dirname, 'skills', SKILL_NAME)
  const skill = fs.existsSync(path.join(sourceDir, 'SKILL.md'))
    ? installReaSkill(hermesHome, sourceDir)
    : 'missing-source'

  return {
    config: applied.state,
    configChanged: applied.changed,
    package: REA_PACKAGE,
    skill
  }
}

module.exports = {
  REA_PACKAGE,
  applyReaConfig,
  ensureReaDefault,
  inspectReaConfig,
  installReaSkill,
  reaServerYaml
}
