const fs = require('node:fs')
const path = require('node:path')

function parseSimpleYaml(text) {
  try {
    return JSON.parse(text)
  } catch {
    // fall through to a tiny YAML subset used by Hermes config
  }

  const root = {}
  let current = root
  let currentKey = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const nested = raw.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/)
    if (nested && currentKey) {
      if (typeof root[currentKey] !== 'object' || root[currentKey] === null) {
        root[currentKey] = {}
      }
      current = root[currentKey]
      current[nested[1]] = coerce(nested[2])
      continue
    }
    const top = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!top) continue
    currentKey = top[1]
    current = root
    root[currentKey] = top[2] ? coerce(top[2]) : {}
  }
  return root
}

function coerce(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed.replace(/^['"]|['"]$/g, '')
}

function dumpSimpleYaml(value, indent = 0) {
  if (value == null) return ''
  if (typeof value !== 'object' || Array.isArray(value)) {
    return String(value)
  }
  const pad = '  '.repeat(indent)
  return Object.entries(value)
    .map(([key, nested]) => {
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return `${pad}${key}:\n${dumpSimpleYaml(nested, indent + 1)}`
      }
      return `${pad}${key}: ${nested}`
    })
    .join('\n')
}

function mergeObject(target, patch) {
  const next = { ...(target && typeof target === 'object' ? target : {}) }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeObject(next[key], value)
    } else {
      next[key] = value
    }
  }
  return next
}

function mergeProviderConfig(config, { cloudUrl, deviceToken }) {
  const next = mergeObject(config, {
    model: {
      provider: 'custom',
      default: 'verxio-qwen'
    },
    custom_provider: {
      name: 'verxio',
      base_url: `${String(cloudUrl || '').replace(/\/$/, '')}/api/inference/v1`,
      api_key: deviceToken
    }
  })
  return next
}

function mergeComposioMcp(config, { mcpUrl, prompt }) {
  const next = mergeObject(config, {})
  if (mcpUrl) {
    next.mcp_servers = mergeObject(next.mcp_servers, {
      composio: {
        enabled: true,
        url: mcpUrl,
        headers: { 'x-api-key': '${COMPOSIO_API_KEY}' }
      }
    })
  }
  if (prompt) {
    next.agent = mergeObject(next.agent, { system_prompt: prompt })
  }
  return next
}

function readConfig(hermesHome) {
  const file = path.join(hermesHome, 'config.yaml')
  if (!fs.existsSync(file)) {
    return {}
  }
  return parseSimpleYaml(fs.readFileSync(file, 'utf8'))
}

function writeConfig(hermesHome, config) {
  fs.mkdirSync(hermesHome, { recursive: true })
  const file = path.join(hermesHome, 'config.yaml')
  const rendered = dumpSimpleYaml(config).trimEnd() + '\n'
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, rendered, 'utf8')
  fs.renameSync(tmp, file)
  return file
}

function applyCloudConfig(hermesHome, payload) {
  const current = readConfig(hermesHome)
  const withProvider = mergeProviderConfig(current, payload)
  const next = mergeComposioMcp(withProvider, payload)
  writeConfig(hermesHome, next)
  return next
}

module.exports = {
  applyCloudConfig,
  dumpSimpleYaml,
  mergeComposioMcp,
  mergeProviderConfig,
  parseSimpleYaml,
  readConfig,
  writeConfig
}
