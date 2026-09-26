const test = require('node:test')
const assert = require('node:assert/strict')

const { mergeComposioMcp, mergeProviderConfig } = require('./cloud-config.cjs')

test('mergeProviderConfig writes the Verxio inference gateway', () => {
  const next = mergeProviderConfig({}, { cloudUrl: 'http://127.0.0.1:8787', deviceToken: 'vxd_test' })
  assert.equal(next.custom_provider.base_url, 'http://127.0.0.1:8787/api/inference/v1')
  assert.equal(next.custom_provider.api_key, 'vxd_test')
  assert.equal(next.model.provider, 'custom')
})

test('mergeComposioMcp keeps unrelated config keys', () => {
  const next = mergeComposioMcp(
    { terminal: { backend: 'local' } },
    { mcpUrl: 'https://mcp.example/session', prompt: 'Use Gmail' }
  )
  assert.equal(next.terminal.backend, 'local')
  assert.equal(next.mcp_servers.composio.url, 'https://mcp.example/session')
  assert.equal(next.agent.system_prompt, 'Use Gmail')
})
