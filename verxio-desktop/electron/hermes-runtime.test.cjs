const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { parseReadyLine, waitForDashboardPort } = require('./hermes-runtime.cjs')

test('parseReadyLine reads the dashboard port', () => {
  assert.equal(parseReadyLine('HERMES_DASHBOARD_READY port=9123'), 9123)
  assert.equal(parseReadyLine('noise'), null)
})

test('waitForDashboardPort resolves from stdout', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  const pending = waitForDashboardPort(child, 1000)
  child.stdout.emit('data', 'booting\nHERMES_DASHBOARD_READY port=9333\n')
  assert.equal(await pending, 9333)
})
