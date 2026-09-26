const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { applyComposioBridge, mergeComposioMcp, mergeProviderConfig } = require('./cloud-config.cjs')

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
  assert.equal(next.mcp_servers.composio.headers['x-api-key'], '${COMPOSIO_API_KEY}')
  assert.equal(next.agent.system_prompt, 'Use Gmail')
})

test('mergeComposioMcp splices the managed prompt and leaves the model alone', () => {
  const block = '<!-- VERXIO_COMPOSIO_CONTEXT_START -->\nUse Gmail\n<!-- VERXIO_COMPOSIO_CONTEXT_END -->'
  const next = mergeComposioMcp(
    {
      model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
      agent: { system_prompt: 'Be concise.' }
    },
    { mcpUrl: 'https://mcp.example/session', prompt: block }
  )
  assert.equal(next.model.provider, 'openai-codex')
  assert.match(next.agent.system_prompt, /Be concise/)
  assert.match(next.agent.system_prompt, /Use Gmail/)
  const again = mergeComposioMcp(next, { mcpUrl: 'https://mcp.example/session', prompt: block })
  assert.equal(again.agent.system_prompt.match(/VERXIO_COMPOSIO_CONTEXT_START/g).length, 1)
})

test('applyComposioBridge writes the session without resetting the model', () => {
  const python = path.resolve(__dirname, '../../hermes-agent/.venv/bin/python')

  if (!fs.existsSync(python)) {
    return
  }

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'verxio-composio-'))

  try {
    fs.writeFileSync(
      path.join(home, 'config.yaml'),
      'model:\n  provider: openai-codex\n  default: gpt-5.6-sol\nagent:\n  system_prompt: Be concise.\n'
    )
    fs.writeFileSync(path.join(home, 'SOUL.md'), 'You are Hermes Agent, created by Nous Research.\n')
    const block = '<!-- VERXIO_COMPOSIO_CONTEXT_START -->\nUse Gmail first\n<!-- VERXIO_COMPOSIO_CONTEXT_END -->'
    const result = applyComposioBridge(
      home,
      {
        agentPrompt: '<!-- verxio-voice -->\nUse the notepad tool and return the public URL.',
        apiKey: 'test-key',
        apiUrl: 'http://127.0.0.1:8787',
        enabled: true,
        mcpUrl: 'https://mcp.example/session',
        prompt: block,
        publicWebUrl: 'https://app.verxio.xyz',
        runtimeToken: 'vxd_test',
        soulPrompt: 'Verxio Notepad and public share URL.\n'
      },
      python
    )
    assert.equal(result.enabled, true)
    const text = fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')
    assert.match(text, /openai-codex/)
    assert.match(text, /Be concise/)
    assert.match(text, /Use Gmail first/)
    assert.match(text, /notepad tool/)
    assert.match(text, /public URL/)
    const soul = fs.readFileSync(path.join(home, 'SOUL.md'), 'utf8')
    assert.match(soul, /Verxio Notepad/)
    assert.doesNotMatch(soul, /Nous Research/)
    assert.match(text, /mcp\.example/)
    assert.match(text, /\$\{COMPOSIO_API_KEY\}/)
    const env = fs.readFileSync(path.join(home, '.env'), 'utf8')
    assert.match(env, /^COMPOSIO_API_KEY=test-key$/m)
    assert.match(env, /^VERXIO_API_URL=http:\/\/127\.0\.0\.1:8787$/m)
    assert.match(env, /^VERXIO_PUBLIC_WEB_URL=https:\/\/app\.verxio\.xyz$/m)
    assert.match(env, /^VERXIO_RUNTIME_TOKEN=vxd_test$/m)
    applyComposioBridge(
      home,
      { apiKey: 'test-key', enabled: true, mcpUrl: 'https://mcp.example/next', prompt: block },
      python
    )
    const rewritten = fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')
    assert.equal(rewritten.match(/VERXIO_COMPOSIO_CONTEXT_START/g).length, 1)
    assert.match(rewritten, /mcp\.example\/next/)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
