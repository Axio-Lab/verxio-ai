const test = require('node:test')
const assert = require('node:assert/strict')

const { localGatewayPath, resolveHermesApiTarget } = require('./gateway-route.cjs')

test('desktop messaging and pairing stay on the local gateway', () => {
  const paths = [
    '/api/messaging/platforms',
    '/api/messaging/platforms/telegram',
    '/api/messaging/platforms/slack/connections/main',
    '/api/messaging/platforms/discord/test',
    '/api/messaging/slack/manifest',
    '/api/messaging/whatsapp/pairing/start',
    '/api/messaging/whatsapp/disconnect',
    '/api/messaging/webhooks',
    '/api/messaging/webhooks/alerts/enabled',
    '/api/messaging/api-server',
    '/api/pairing',
    '/api/pairing/approve'
  ]

  for (const path of paths) {
    assert.equal(resolveHermesApiTarget({ path, scope: 'cloud', hasLocalHermes: true }), 'local', path)
  }
})

test('messaging falls back to the cloud dashboard when the desktop agent is down', () => {
  assert.equal(
    resolveHermesApiTarget({ path: '/api/messaging/platforms', scope: 'cloud', hasLocalHermes: false }),
    'cloud'
  )
})

test('cron stays on the cloud dashboard', () => {
  assert.equal(resolveHermesApiTarget({ path: '/api/cron/jobs', scope: 'cloud', hasLocalHermes: true }), 'cloud')
})

test('chat stays on the local agent', () => {
  assert.equal(resolveHermesApiTarget({ path: '/api/sessions', scope: 'local', hasLocalHermes: true }), 'local')
})

test('webhook management maps onto the local gateway routes', () => {
  assert.equal(localGatewayPath('/api/messaging/webhooks'), '/api/webhooks')
  assert.equal(localGatewayPath('/api/messaging/webhooks/enable'), '/api/webhooks/enable')
  assert.equal(localGatewayPath('/api/messaging/webhooks/alerts'), '/api/webhooks/alerts')
  assert.equal(localGatewayPath('/api/messaging/webhooks/alerts/enabled'), '/api/webhooks/alerts/enabled')
  assert.equal(localGatewayPath('/api/messaging/platforms'), '/api/messaging/platforms')
})
