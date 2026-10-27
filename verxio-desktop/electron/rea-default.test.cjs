const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { REA_PACKAGE, applyReaConfig, ensureReaDefault, inspectReaConfig } = require('./rea-default.cjs')

const EXISTING = `# keep this comment
model:
  provider: custom
mcp_servers:
  composio:
    url: https://mcp.example/session
    enabled: true
toolsets:
  - hermes-cli
`

test('applyReaConfig adds REA beside an existing server and keeps comments', () => {
  const next = applyReaConfig(EXISTING)
  assert.equal(next.changed, true)
  assert.equal(next.state, 'missing')
  assert.match(next.text, /# keep this comment/)
  assert.match(next.text, /url: https:\/\/mcp\.example\/session/)
  assert.match(next.text, new RegExp(REA_PACKAGE.replace('@', '\\@')))
  assert.match(next.text, /toolsets:\n {2}- hermes-cli/)
  assert.equal(inspectReaConfig(next.text), 'current')
})

test('applyReaConfig leaves a custom REA server alone', () => {
  const custom = `mcp_servers:\n  rea:\n    command: /usr/local/bin/rea\n    args:\n      - mcp\n`
  const next = applyReaConfig(custom)
  assert.equal(next.changed, false)
  assert.equal(next.state, 'custom')
  assert.match(next.text, /\/usr\/local\/bin\/rea/)
})

test('applyReaConfig leaves a disabled Verxio REA server off', () => {
  const disabled = applyReaConfig('').text.replace('enabled: true', 'enabled: false')
  const next = applyReaConfig(disabled)
  assert.equal(next.state, 'disabled')
  assert.equal(next.changed, false)
  assert.match(next.text, /enabled: false/)
})

test('applyReaConfig refreshes an outdated Verxio pin', () => {
  const current = applyReaConfig('mcp_servers:\n  composio:\n    url: https://mcp.example/session\n').text
  const outdated = current.replace(REA_PACKAGE, 'rea-agents@1.0.0')
  const next = applyReaConfig(outdated)
  assert.equal(next.state, 'outdated')
  assert.equal(next.changed, true)
  assert.match(next.text, new RegExp(REA_PACKAGE.replace('@', '\\@')))
  assert.doesNotMatch(next.text, /rea-agents@1\.0\.0/)
  assert.match(next.text, /url: https:\/\/mcp\.example\/session/)
})

test('ensureReaDefault writes the skill once and keeps a user edit', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'verxio-rea-'))
  const source = path.join(__dirname, 'skills', 'reverse-engineer-anything')
  const first = ensureReaDefault({ hermesHome: home, skillDir: source })
  const skillPath = path.join(home, 'skills', 'research', 'reverse-engineer-anything', 'SKILL.md')

  assert.equal(first.skill, 'installed')
  assert.equal(first.config, 'missing-section')
  assert.match(fs.readFileSync(skillPath, 'utf8'), /mcp_rea_/)

  const second = ensureReaDefault({ hermesHome: home, skillDir: source })
  assert.equal(second.skill, 'current')
  assert.equal(second.configChanged, false)

  fs.writeFileSync(skillPath, '# user edit\n')
  const third = ensureReaDefault({ hermesHome: home, skillDir: source })
  assert.equal(third.skill, 'kept-user')
  assert.equal(fs.readFileSync(skillPath, 'utf8'), '# user edit\n')
})
