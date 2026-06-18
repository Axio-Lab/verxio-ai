const { contextBridge, ipcRenderer, webUtils } = require('electron')
const crypto = require('node:crypto')

const CONNECTION_CONFIG_KEY = 'verxio.desktop.connection.config'
const ACTIVE_PROFILE_KEY = 'verxio.desktop.active.profile'

const bootListeners = new Set()
const backendExitListeners = new Set()
const previewListeners = new Set()
const bootstrapListeners = new Set()
const updateProgressListeners = new Set()

let bootProgress = {
  error: null,
  fakeMode: false,
  message: 'Connecting to Verxio backend...',
  phase: 'backend.resolve',
  progress: 12,
  running: true,
  timestamp: Date.now()
}

function emitBoot(patch) {
  bootProgress = { ...bootProgress, ...patch, timestamp: Date.now() }

  for (const listener of bootListeners) {
    listener(bootProgress)
  }
}

function envValue(name, fallback = '') {
  const value = process.env[name]

  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function verxioApiBaseUrl() {
  return envValue('VERXIO_API_URL', envValue('VITE_VERXIO_API_URL', 'http://127.0.0.1:8787')).replace(/\/$/, '')
}

function verxioApiEnabled() {
  const flag = envValue('VITE_VERXIO_API_ENABLED').toLowerCase()
  const directHermesUrl = envValue('VITE_HERMES_DASHBOARD_URL')

  if (flag === '0' || flag === 'false') {
    return false
  }

  if (flag === '1' || flag === 'true' || Boolean(verxioApiBaseUrl())) {
    return true
  }

  return !directHermesUrl
}

function hermesDashboardBaseUrl() {
  return envValue('HERMES_DASHBOARD_URL', envValue('VITE_HERMES_DASHBOARD_URL')).replace(/\/$/, '')
}

function verxioApiUrl(path) {
  const base = verxioApiBaseUrl()
  const normalized = path.startsWith('/') ? path : `/${path}`

  return `${base}${normalized}`
}

function buildApiUrl(path) {
  if (verxioApiEnabled()) {
    if (
      path.startsWith('/api/auth') ||
      path.startsWith('/api/artifacts') ||
      path.startsWith('/api/bootstrap') ||
      path.startsWith('/api/health') ||
      path.startsWith('/api/hermes') ||
      path === '/api/profile' ||
      path.startsWith('/api/profile?') ||
      path.startsWith('/api/runtime')
    ) {
      return verxioApiUrl(path)
    }

    if (path.startsWith('/api/') || path.startsWith('/dashboard-plugins')) {
      return verxioApiUrl(`/api/runtime/dashboard${path}`)
    }

    return verxioApiUrl(path)
  }

  const base = hermesDashboardBaseUrl()

  if (base) {
    return `${base}${path}`
  }

  return path
}

function buildWsUrl(path, params) {
  if (verxioApiEnabled()) {
    const base = verxioApiBaseUrl()
    const origin = base || window.location.origin
    const parsed = new URL(origin)
    const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    const pathname = parsed.pathname.replace(/\/$/, '')
    const qs = new URLSearchParams(params)

    return `${proto}//${parsed.host}${pathname}/api/runtime/dashboard/ws${path}?${qs.toString()}`
  }

  const base = hermesDashboardBaseUrl()
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = base ? new URL(base).host : window.location.host
  const pathname = base ? new URL(base).pathname.replace(/\/$/, '') : ''
  const qs = new URLSearchParams(params)

  return `${proto}//${host}${pathname}${path}?${qs.toString()}`
}

function fetchCredentials() {
  return verxioApiEnabled() ? 'include' : 'same-origin'
}

function getToken() {
  return window.__HERMES_SESSION_TOKEN__ ?? 'verxio-proxy'
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000)

  try {
    const response = await fetch(url, {
      ...init,
      credentials: fetchCredentials(),
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`${response.status}: ${text || response.statusText}`)
    }

    if (response.status === 204) {
      return undefined
    }

    return await response.json()
  } finally {
    window.clearTimeout(timeout)
  }
}

async function waitForDashboardReady() {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const res = await fetch(buildApiUrl('/api/status'), {
        credentials: fetchCredentials()
      })

      if (res.ok) {
        return
      }
    } catch {
      // retry
    }

    await new Promise(resolve => window.setTimeout(resolve, 500))
  }

  if (verxioApiEnabled()) {
    throw new Error('Verxio agent runtime is not reachable. Start verxio-api, sign in, then reload Verxio Desktop.')
  }

  throw new Error('Hermes dashboard is not reachable. Start it with: hermes dashboard --no-open')
}

async function getConnection() {
  await waitForDashboardReady()

  emitBoot({
    phase: 'backend.ready',
    message: 'Verxio backend is ready',
    progress: 94,
    running: true,
    error: null
  })

  const token = verxioApiEnabled() ? 'verxio-proxy' : getToken()
  const baseUrl = verxioApiEnabled()
    ? verxioApiUrl('/api/runtime/dashboard')
    : hermesDashboardBaseUrl() || window.location.origin

  return {
    baseUrl,
    token,
    wsUrl: buildWsUrl('/api/ws', { token }),
    mode: 'local',
    authMode: 'token',
    source: 'local',
    logs: [],
    isFullscreen: false,
    nativeOverlayWidth: await ipcRenderer.invoke('verxio:window:nativeOverlayWidth'),
    windowButtonPosition: await ipcRenderer.invoke('verxio:window:buttonPosition')
  }
}

function readConnectionConfig(profile = null) {
  try {
    const raw = localStorage.getItem(CONNECTION_CONFIG_KEY)

    if (raw) {
      return JSON.parse(raw)
    }
  } catch {
    // ignore
  }

  return {
    envOverride: false,
    mode: 'local',
    profile,
    remoteAuthMode: 'token',
    remoteOauthConnected: false,
    remoteTokenPreview: null,
    remoteTokenSet: false,
    remoteUrl: ''
  }
}

function writeConnectionConfig(config) {
  localStorage.setItem(CONNECTION_CONFIG_KEY, JSON.stringify(config))
}

function staticBootstrapState() {
  return {
    active: false,
    manifest: null,
    stages: {},
    error: null,
    log: [],
    startedAt: null,
    completedAt: null,
    unsupportedPlatform: null
  }
}

contextBridge.exposeInMainWorld('hermesDesktop', {
  getConnection,
  revalidateConnection: getConnection,
  touchBackend: async () => ({ ok: true }),
  getGatewayWsUrl: async () => {
    const conn = await getConnection()

    return conn.wsUrl
  },
  getBootProgress: async () => bootProgress,
  getConnectionConfig: async profile => readConnectionConfig(profile ?? null),
  saveConnectionConfig: async payload => {
    const current = readConnectionConfig(payload?.profile ?? null)
    const next = {
      ...current,
      mode: payload?.mode ?? current.mode,
      profile: payload?.profile ?? null,
      remoteAuthMode: payload?.remoteAuthMode ?? current.remoteAuthMode,
      remoteUrl: payload?.remoteUrl ?? current.remoteUrl,
      remoteTokenSet: Boolean(payload?.remoteToken),
      remoteTokenPreview: payload?.remoteToken ? '********' : current.remoteTokenPreview
    }

    writeConnectionConfig(next)

    return next
  },
  applyConnectionConfig: async payload => {
    const next = await window.hermesDesktop.saveConnectionConfig(payload)
    window.location.reload()

    return next
  },
  testConnectionConfig: async payload => {
    const url = payload?.remoteUrl?.trim()

    if (!url) {
      return { ok: false, baseUrl: '', version: null }
    }

    try {
      const status = await fetchJson(`${url.replace(/\/$/, '')}/api/status`)

      return { ok: true, baseUrl: url, version: status?.version ?? null }
    } catch {
      return { ok: false, baseUrl: url, version: null }
    }
  },
  probeConnectionConfig: async remoteUrl => {
    const baseUrl = String(remoteUrl || '').replace(/\/$/, '')

    try {
      const status = await fetchJson(`${baseUrl}/api/status`)

      return {
        baseUrl,
        reachable: true,
        authMode: status?.auth_required ? 'oauth' : 'token',
        providers: [],
        version: status?.version ?? null,
        error: null
      }
    } catch (error) {
      return {
        baseUrl,
        reachable: false,
        authMode: 'unknown',
        providers: [],
        version: null,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },
  oauthLoginConnectionConfig: async remoteUrl => {
    await ipcRenderer.invoke('verxio:openExternal', remoteUrl)

    return { ok: true, baseUrl: remoteUrl, connected: false }
  },
  oauthLogoutConnectionConfig: async () => ({ ok: true, connected: false }),
  profile: {
    get: async () => ({ profile: localStorage.getItem(ACTIVE_PROFILE_KEY) }),
    set: async name => {
      if (name) {
        localStorage.setItem(ACTIVE_PROFILE_KEY, name)
      } else {
        localStorage.removeItem(ACTIVE_PROFILE_KEY)
      }

      window.location.reload()

      return { profile: name }
    }
  },
  api: async request =>
    fetchJson(buildApiUrl(request.path), {
      method: request.method ?? 'GET',
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      timeoutMs: request.timeoutMs
    }),
  notify: payload => ipcRenderer.invoke('verxio:notify', payload),
  audio: {
    captureSupport: () => ipcRenderer.invoke('verxio:audio:captureSupport'),
    listCaptureSources: () => ipcRenderer.invoke('verxio:audio:listCaptureSources'),
    prepareCaptureSource: sourceId => ipcRenderer.invoke('verxio:audio:prepareCaptureSource', sourceId)
  },
  requestMicrophoneAccess: async () => {
    const nativeAllowed = await ipcRenderer.invoke('verxio:requestMicrophoneAccess')

    if (!nativeAllowed || !navigator.mediaDevices?.getUserMedia) {
      return Boolean(nativeAllowed)
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())

      return true
    } catch {
      return false
    }
  },
  readFileDataUrl: filePath => ipcRenderer.invoke('verxio:readFileDataUrl', filePath),
  readFileText: filePath => ipcRenderer.invoke('verxio:readFileText', filePath),
  selectPaths: options => ipcRenderer.invoke('verxio:selectPaths', options),
  writeClipboard: text => ipcRenderer.invoke('verxio:writeClipboard', text),
  saveImageFromUrl: url => ipcRenderer.invoke('verxio:saveImageFromUrl', url),
  saveImageBuffer: (data, ext) => ipcRenderer.invoke('verxio:saveImageBuffer', { data, ext }),
  saveClipboardImage: () => ipcRenderer.invoke('verxio:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('verxio:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('verxio:watchPreviewFile', url),
  stopPreviewFileWatch: id => ipcRenderer.invoke('verxio:stopPreviewFileWatch', id),
  setTitleBarTheme: payload => ipcRenderer.send('verxio:titlebar-theme', payload),
  setPreviewShortcutActive: active => ipcRenderer.send('verxio:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('verxio:openExternal', url),
  fetchLinkTitle: async url => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const html = await response.text()
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()

      return title || url
    } catch {
      return url
    }
  },
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('verxio:setting:defaultProjectDir:get'),
    pickDefaultProjectDir: () => ipcRenderer.invoke('verxio:setting:defaultProjectDir:pick'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('verxio:setting:defaultProjectDir:set', dir)
  },
  workspace: {
    ensure: () => ipcRenderer.invoke('verxio:workspace:ensure')
  },
  revealLogs: () => ipcRenderer.invoke('verxio:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('verxio:logs:recent'),
  readDir: dirPath => ipcRenderer.invoke('verxio:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('verxio:fs:gitRoot', startPath),
  permissions: {
    grantFolder: () => ipcRenderer.invoke('verxio:fs:permissions:grantFolder'),
    isAllowed: targetPath => ipcRenderer.invoke('verxio:fs:permissions:isAllowed', targetPath),
    list: () => ipcRenderer.invoke('verxio:fs:permissions:list'),
    revokeFolder: folder => ipcRenderer.invoke('verxio:fs:permissions:revokeFolder', folder)
  },
  leash: {
    getAgent: () => ipcRenderer.invoke('verxio:leash:getAgent'),
    setAgent: config => ipcRenderer.invoke('verxio:leash:setAgent', config),
    clearAgent: () => ipcRenderer.invoke('verxio:leash:clearAgent'),
    getBannerNeverShow: () => ipcRenderer.invoke('verxio:leash:getBannerNeverShow'),
    setBannerNeverShow: value => ipcRenderer.invoke('verxio:leash:setBannerNeverShow', Boolean(value))
  },
  terminal: {
    dispose: id => ipcRenderer.invoke('verxio:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('verxio:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('verxio:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('verxio:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `verxio:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `verxio:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('verxio:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('verxio:close-preview-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('verxio:open-updates', listener)

    return () => ipcRenderer.removeListener('verxio:open-updates', listener)
  },
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('verxio:window-state-changed', listener)

    return () => ipcRenderer.removeListener('verxio:window-state-changed', listener)
  },
  onPreviewFileChanged: callback => {
    previewListeners.add(callback)

    return () => previewListeners.delete(callback)
  },
  onBackendExit: callback => {
    backendExitListeners.add(callback)

    return () => backendExitListeners.delete(callback)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('verxio:power-resume', listener)

    return () => ipcRenderer.removeListener('verxio:power-resume', listener)
  },
  onBootProgress: callback => {
    bootListeners.add(callback)
    callback(bootProgress)

    return () => bootListeners.delete(callback)
  },
  getBootstrapState: async () => staticBootstrapState(),
  resetBootstrap: async () => ({ ok: true }),
  repairBootstrap: async () => ({ ok: true }),
  cancelBootstrap: async () => ({ ok: true, cancelled: false }),
  onBootstrapEvent: callback => {
    bootstrapListeners.add(callback)

    return () => bootstrapListeners.delete(callback)
  },
  getVersion: () => ipcRenderer.invoke('verxio:version'),
  updates: {
    check: async () => ({
      supported: false,
      reason: 'Local Verxio Desktop packaging updates are not enabled in this phase.'
    }),
    apply: async () => ({
      ok: false,
      manual: true,
      command: 'git pull && npm run desktop:build',
      message: 'Update this local checkout, then rebuild Verxio Desktop.'
    }),
    getBranch: async () => ({ branch: 'local' }),
    setBranch: async name => ({ branch: name }),
    onProgress: callback => {
      updateProgressListeners.add(callback)

      return () => updateProgressListeners.delete(callback)
    }
  }
})

ipcRenderer.on('verxio:preview-file-changed', (_event, payload) => {
  for (const listener of previewListeners) {
    listener(payload)
  }
})

ipcRenderer.on('verxio:backend-exit', (_event, payload) => {
  for (const listener of backendExitListeners) {
    listener(payload)
  }
})

ipcRenderer.on('verxio:boot-progress', (_event, payload) => {
  emitBoot(payload)
})

window.addEventListener('DOMContentLoaded', () => {
  emitBoot({
    phase: 'renderer.ready',
    message: 'Verxio Desktop bridge is ready',
    progress: 100,
    running: false,
    error: null
  })
})
