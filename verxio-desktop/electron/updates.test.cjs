const test = require('node:test')
const assert = require('node:assert/strict')

const { createUpdater, shouldCheckForUpdates, statusForFeed } = require('./updates.cjs')

test('0.0.1 is behind feed 0.0.2', () => {
  const status = statusForFeed('0.0.1', '0.0.2')

  assert.equal(status.supported, true)
  assert.equal(status.behind, 1)
  assert.equal(status.targetSha, '0.0.2')
})

test('the same feed version is not an update', () => {
  const status = statusForFeed('0.0.2', '0.0.2')

  assert.equal(status.behind, 0)
  assert.equal(status.targetSha, undefined)
})

test('an older feed version is not an update', () => {
  const status = statusForFeed('0.0.2', '0.0.1')

  assert.equal(status.behind, 0)
  assert.equal(status.targetSha, undefined)
})

test('an unpackaged app does not check', async () => {
  assert.equal(shouldCheckForUpdates({ isPackaged: false, feedUrl: '' }), false)
  assert.equal(shouldCheckForUpdates({ isPackaged: false, feedUrl: 'http://127.0.0.1:9/updates' }), true)

  const updater = createUpdater({ isPackaged: false, feedUrl: '' })
  const status = await updater.check()

  assert.equal(status.supported, true)
  assert.equal(status.behind, 0)
  assert.match(status.message, /packaged builds/)
})
