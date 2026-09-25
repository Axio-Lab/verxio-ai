const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { parseReadyLine, resolvePython, waitForDashboardPort } = require('./hermes-runtime.cjs')

test('parseReadyLine reads the dashboard port', () => {
  assert.equal(parseReadyLine('HERMES_DASHBOARD_READY port=9123'), 9123)
  assert.equal(parseReadyLine('noise'), null)
})

test('resolvePython prefers the Hermes .venv', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-py-'))
  const binary = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  const python = path.join(root, '.venv', binary)

  fs.mkdirSync(path.dirname(python), { recursive: true })
  fs.writeFileSync(python, '')
  assert.equal(resolvePython(root), python)
})

test('waitForDashboardPort resolves from stdout', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  const pending = waitForDashboardPort(child, 1000)
  child.stdout.emit('data', 'booting\nHERMES_DASHBOARD_READY port=9333\n')
  assert.equal(await pending, 9333)
})
