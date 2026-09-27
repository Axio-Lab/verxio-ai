const test = require('node:test')
const assert = require('node:assert/strict')

const { isAllowedPath, newerWins, normalizePath } = require('./agent-sync.cjs')

test('allowlist accepts memory, skills, SOUL, and config', () => {
  assert.equal(isAllowedPath('SOUL.md'), true)
  assert.equal(isAllowedPath('memory/notes.md'), true)
  assert.equal(isAllowedPath('skills/foo/SKILL.md'), true)
  assert.equal(isAllowedPath('config.yaml'), true)
  assert.equal(isAllowedPath('not-allowed.txt'), false)
})

test('desktop cannot write outputs/', () => {
  assert.equal(isAllowedPath('outputs/report.md'), true)
  assert.equal(isAllowedPath('outputs/report.md', { write: true, actor: 'desktop' }), false)
  assert.equal(isAllowedPath('outputs/report.md', { write: true, actor: 'cloud' }), true)
})

test('normalizePath rejects traversal', () => {
  assert.equal(normalizePath('../etc/passwd'), null)
  assert.equal(normalizePath('memory/hello.md'), 'memory/hello.md')
})

test('newer ETag / timestamp wins', () => {
  assert.equal(newerWins('2026-09-24T10:00:00Z', '2026-09-24T12:00:00Z'), 'remote')
  assert.equal(newerWins('2026-09-24T12:00:00Z', '2026-09-24T10:00:00Z'), 'local')
})
