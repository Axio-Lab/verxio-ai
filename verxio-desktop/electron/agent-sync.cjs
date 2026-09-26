const ALLOW_PREFIXES = ['memory/', 'skills/', 'outputs/']
const ALLOW_FILES = new Set(['soul.md', 'config.yaml'])

function normalizePath(pathValue) {
  const cleaned = String(pathValue || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!cleaned || cleaned.split('/').includes('..')) {
    return null
  }
  return cleaned
}

function isAllowedPath(pathValue, { write = false, actor = 'desktop' } = {}) {
  const cleaned = normalizePath(pathValue)
  if (!cleaned) return false
  const lowered = cleaned.toLowerCase()
  if (ALLOW_FILES.has(lowered)) return true
  if (ALLOW_PREFIXES.some(prefix => lowered === prefix.slice(0, -1) || lowered.startsWith(prefix))) {
    if (write && actor === 'desktop' && lowered.startsWith('outputs/')) {
      return false
    }
    return true
  }
  return false
}

function newerWins(localUpdatedAt, remoteUpdatedAt) {
  const local = Date.parse(localUpdatedAt || '')
  const remote = Date.parse(remoteUpdatedAt || '')
  if (Number.isNaN(local)) return 'remote'
  if (Number.isNaN(remote)) return 'local'
  return remote >= local ? 'remote' : 'local'
}

async function pullState({ cloudUrl, token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${cloudUrl.replace(/\/$/, '')}/api/agent/state`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!response.ok) {
    throw new Error(`Agent state pull failed (${response.status})`)
  }
  return response.json()
}

async function pushFile({ cloudUrl, token, path: filePath, content, etag, fetchImpl = fetch } = {}) {
  if (!isAllowedPath(filePath, { write: true, actor: 'desktop' })) {
    throw new Error(`Path is not syncable from the desktop: ${filePath}`)
  }
  const headers = { Authorization: `Bearer ${token}` }
  if (etag) headers['If-Match'] = etag
  const response = await fetchImpl(`${cloudUrl.replace(/\/$/, '')}/api/agent/state/${filePath}`, {
    method: 'PUT',
    headers,
    body: content
  })
  if (!response.ok) {
    throw new Error(`Agent state push failed (${response.status})`)
  }
  return response.json()
}

module.exports = {
  isAllowedPath,
  newerWins,
  normalizePath,
  pullState,
  pushFile
}
