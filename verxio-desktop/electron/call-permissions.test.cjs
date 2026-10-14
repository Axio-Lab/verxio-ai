const test = require('node:test')
const assert = require('node:assert/strict')

const { callPermissionAllowed } = require('./call-permissions.cjs')

test('call media is allowed for Daily and the app origin only', () => {
  assert.equal(callPermissionAllowed('https://tavus.daily.co/room', 'media', 'http://127.0.0.1:5180'), true)
  assert.equal(callPermissionAllowed('http://127.0.0.1:5180/', 'display-capture', 'http://127.0.0.1:5180'), true)
  assert.equal(callPermissionAllowed('https://evil.example/room', 'media', 'http://127.0.0.1:5180'), false)
  assert.equal(callPermissionAllowed('https://tavus.daily.co/room', 'notifications', 'http://127.0.0.1:5180'), false)
})
