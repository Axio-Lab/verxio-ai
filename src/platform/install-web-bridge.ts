import type {
  BackendExit,
  DesktopActiveProfile,
  DesktopBootProgress,
  DesktopBootstrapState,
  DesktopConnectionConfig,
  DesktopConnectionConfigInput,
  DesktopConnectionProbeResult,
  DesktopConnectionTestResult,
  DesktopOauthLoginResult,
  DesktopOauthLogoutResult,
  DesktopUpdateApplyOptions,
  DesktopUpdateApplyResult,
  DesktopUpdateStatus,
  DesktopVersionInfo,
  HermesApiRequest,
  HermesConnection,
  HermesNotification,
  HermesPreviewFileChanged,
  HermesPreviewTarget,
  HermesPreviewWatch,
  HermesReadDirResult,
  HermesReadFileTextResult,
  HermesSelectPathsOptions,
  HermesTerminalExit,
  HermesTerminalSession,
  HermesWindowState
} from '@/global'

declare global {
  interface Window {
    __VERXIO_WEB__?: boolean
  }
}

const CONNECTION_CONFIG_KEY = 'verxio.connection.config'
const ACTIVE_PROFILE_KEY = 'verxio.active.profile'
const DEFAULT_PROJECT_DIR_KEY = 'verxio.default.project.dir'

type Listener<T> = (payload: T) => void

interface PtySession {
  id: string
  channel: string
  cwd: string
  shell: string
  ws: WebSocket
  dataListeners: Set<(payload: string) => void>
  exitListeners: Set<(payload: HermesTerminalExit) => void>
}

const bootListeners = new Set<Listener<DesktopBootProgress>>()
const backendExitListeners = new Set<Listener<BackendExit>>()
const previewListeners = new Set<Listener<HermesPreviewFileChanged>>()

let bootProgress: DesktopBootProgress = {
  error: null,
  fakeMode: false,
  message: 'Connecting to Verxio backend…',
  phase: 'backend.resolve',
  progress: 12,
  running: true,
  timestamp: Date.now()
}

const ptySessions = new Map<string, PtySession>()
const previewWatches = new Map<string, HermesPreviewWatch>()

function getToken(): string {
  return window.__HERMES_SESSION_TOKEN__ ?? ''
}

function apiBaseUrl(): string {
  return import.meta.env.VITE_HERMES_DASHBOARD_URL?.replace(/\/$/, '') ?? ''
}

function buildApiUrl(path: string): string {
  const base = apiBaseUrl()
  if (base) {
    return `${base}${path}`
  }
  return path
}

function buildWsUrl(path: string, params: Record<string, string>): string {
  const base = apiBaseUrl()
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = base ? new URL(base).host : window.location.host
  const pathname = base ? new URL(base).pathname.replace(/\/$/, '') : ''
  const qs = new URLSearchParams(params)
  return `${proto}//${host}${pathname}${path}?${qs.toString()}`
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init.headers ?? {})
      }
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${res.status}: ${text || res.statusText}`)
    }
    if (res.status === 204) {
      return undefined as T
    }
    return (await res.json()) as T
  } finally {
    window.clearTimeout(timeout)
  }
}

function emitBoot(patch: Partial<DesktopBootProgress>) {
  bootProgress = { ...bootProgress, ...patch, timestamp: Date.now() }
  for (const listener of bootListeners) {
    listener(bootProgress)
  }
}

async function waitForDashboardReady(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(buildApiUrl('/api/status'))
      if (res.ok) {
        return
      }
    } catch {
      // retry
    }
    await new Promise(resolve => window.setTimeout(resolve, 500))
  }
  throw new Error('Verxio backend is not reachable. Start it with: hermes dashboard --no-open')
}

async function getConnection(): Promise<HermesConnection> {
  await waitForDashboardReady()
  const token = getToken()
  if (!token) {
    throw new Error('Missing Verxio session token. Restart hermes dashboard and reload.')
  }

  emitBoot({
    phase: 'backend.ready',
    message: 'Verxio backend is ready',
    progress: 94,
    running: true,
    error: null
  })

  const wsUrl = buildWsUrl('/api/ws', { token })
  const baseUrl = apiBaseUrl() || window.location.origin

  return {
    baseUrl,
    token,
    wsUrl,
    mode: 'local',
    authMode: 'token',
    source: 'local',
    logs: [],
    isFullscreen: false,
    nativeOverlayWidth: 0,
    windowButtonPosition: null
  }
}

function readConnectionConfig(): DesktopConnectionConfig {
  try {
    const raw = localStorage.getItem(CONNECTION_CONFIG_KEY)
    if (raw) {
      return JSON.parse(raw) as DesktopConnectionConfig
    }
  } catch {
    // ignore
  }
  return {
    envOverride: false,
    mode: 'local',
    profile: null,
    remoteAuthMode: 'token',
    remoteOauthConnected: false,
    remoteTokenPreview: null,
    remoteTokenSet: false,
    remoteUrl: ''
  }
}

function writeConnectionConfig(config: DesktopConnectionConfig) {
  localStorage.setItem(CONNECTION_CONFIG_KEY, JSON.stringify(config))
}

export function installWebBridge(): void {
  if (typeof window === 'undefined' || window.hermesDesktop) {
    return
  }

  window.__VERXIO_WEB__ = true

  window.hermesDesktop = {
    getConnection: async () => getConnection(),
    touchBackend: async () => ({ ok: true }),
    getGatewayWsUrl: async () => {
      const conn = await getConnection()
      return conn.wsUrl
    },
    getBootProgress: async () => bootProgress,
    getConnectionConfig: async () => readConnectionConfig(),
    saveConnectionConfig: async (payload: DesktopConnectionConfigInput) => {
      const current = readConnectionConfig()
      const next: DesktopConnectionConfig = {
        ...current,
        mode: payload.mode,
        profile: payload.profile ?? null,
        remoteAuthMode: payload.remoteAuthMode ?? current.remoteAuthMode,
        remoteUrl: payload.remoteUrl ?? current.remoteUrl,
        remoteTokenSet: Boolean(payload.remoteToken),
        remoteTokenPreview: payload.remoteToken ? '••••••••' : current.remoteTokenPreview
      }
      writeConnectionConfig(next)
      return next
    },
    applyConnectionConfig: async (payload: DesktopConnectionConfigInput) => {
      const next = await window.hermesDesktop.saveConnectionConfig(payload)
      window.location.reload()
      return next
    },
    testConnectionConfig: async (payload: DesktopConnectionConfigInput) => {
      const url = payload.remoteUrl?.trim()
      if (!url) {
        return { ok: false, baseUrl: '', version: null } satisfies DesktopConnectionTestResult
      }
      try {
        const status = await fetchJson<{ version?: string }>(`${url.replace(/\/$/, '')}/api/status`)
        return {
          ok: true,
          baseUrl: url,
          version: status?.version ?? null
        }
      } catch {
        return { ok: false, baseUrl: url, version: null }
      }
    },
    probeConnectionConfig: async (remoteUrl: string) => {
      const baseUrl = remoteUrl.replace(/\/$/, '')
      try {
        const status = await fetchJson<{
          auth_required?: boolean
          version?: string
        }>(`${baseUrl}/api/status`)
        return {
          baseUrl,
          reachable: true,
          authMode: status.auth_required ? 'oauth' : 'token',
          providers: [],
          version: status.version ?? null,
          error: null
        } satisfies DesktopConnectionProbeResult
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
    oauthLoginConnectionConfig: async (remoteUrl: string) => {
      window.open(remoteUrl, '_blank', 'noopener,noreferrer')
      return { ok: true, baseUrl: remoteUrl, connected: false } satisfies DesktopOauthLoginResult
    },
    oauthLogoutConnectionConfig: async () => {
      return { ok: true, connected: false } satisfies DesktopOauthLogoutResult
    },
    profile: {
      get: async () => {
        const profile = localStorage.getItem(ACTIVE_PROFILE_KEY)
        return { profile } satisfies DesktopActiveProfile
      },
      set: async (name: string | null) => {
        if (name) {
          localStorage.setItem(ACTIVE_PROFILE_KEY, name)
        } else {
          localStorage.removeItem(ACTIVE_PROFILE_KEY)
        }
        window.location.reload()
        return { profile: name }
      }
    },
    api: async <T>(request: HermesApiRequest) => {
      const url = buildApiUrl(request.path)
      return fetchJson<T>(url, {
        method: request.method ?? 'GET',
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
        timeoutMs: request.timeoutMs
      })
    },
    notify: async (payload: HermesNotification) => {
      if (!('Notification' in window)) {
        return false
      }
      if (Notification.permission === 'granted') {
        new Notification(payload.title ?? 'Verxio', {
          body: payload.body ?? '',
          silent: Boolean(payload.silent)
        })
        return true
      }
      if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission()
        if (permission === 'granted') {
          return window.hermesDesktop.notify(payload)
        }
      }
      return false
    },
    requestMicrophoneAccess: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())
        return true
      } catch {
        return false
      }
    },
    readFileDataUrl: async () => {
      throw new Error('File preview is not available in Verxio Web yet.')
    },
    readFileText: async (filePath: string) => {
      return {
        path: filePath,
        text: '',
        binary: true
      } satisfies HermesReadFileTextResult
    },
    selectPaths: async (options?: HermesSelectPathsOptions) => {
      void options
      return []
    },
    writeClipboard: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },
    saveImageFromUrl: async () => false,
    saveImageBuffer: async () => '',
    saveClipboardImage: async () => '',
    getPathForFile: (file: File) => file.name,
    normalizePreviewTarget: async () => null,
    watchPreviewFile: async (url: string) => {
      const id = crypto.randomUUID()
      const watch = { id, path: url }
      previewWatches.set(id, watch)
      return watch
    },
    stopPreviewFileWatch: async (id: string) => {
      previewWatches.delete(id)
      return true
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    fetchLinkTitle: async (url: string) => url,
    settings: {
      getDefaultProjectDir: async () => ({
        defaultLabel: 'Project directory',
        dir: localStorage.getItem(DEFAULT_PROJECT_DIR_KEY)
      }),
      pickDefaultProjectDir: async () => ({ canceled: true, dir: null }),
      setDefaultProjectDir: async (dir: string | null) => {
        if (dir) {
          localStorage.setItem(DEFAULT_PROJECT_DIR_KEY, dir)
        } else {
          localStorage.removeItem(DEFAULT_PROJECT_DIR_KEY)
        }
        return { dir }
      }
    },
    revealLogs: async () => ({ ok: false, path: '', error: 'Logs are on the Verxio host machine.' }),
    getRecentLogs: async () => ({ path: '', lines: [] }),
    readDir: async (dirPath: string) => {
      try {
        const params = new URLSearchParams({ path: dirPath })
        return await fetchJson<HermesReadDirResult>(buildApiUrl(`/api/fs/readdir?${params.toString()}`))
      } catch (error) {
        return {
          entries: [],
          error: error instanceof Error ? error.message : 'read-error'
        } satisfies HermesReadDirResult
      }
    },
    gitRoot: async (startPath: string) => {
      try {
        const params = new URLSearchParams({ path: startPath })
        const result = await fetchJson<{ root: string | null }>(buildApiUrl(`/api/fs/git-root?${params.toString()}`))
        return result.root
      } catch {
        return null
      }
    },
    terminal: {
      start: async (options = {}) => {
        const id = crypto.randomUUID()
        const channel = id
        const token = getToken()
        const ws = new WebSocket(buildWsUrl('/api/pty', { token, channel }))
        const session: PtySession = {
          id,
          channel,
          cwd: options.cwd ?? '',
          shell: 'shell',
          ws,
          dataListeners: new Set(),
          exitListeners: new Set()
        }
        ptySessions.set(id, session)

        ws.onmessage = event => {
          const payload = typeof event.data === 'string' ? event.data : ''
          for (const listener of session.dataListeners) {
            listener(payload)
          }
        }
        ws.onclose = () => {
          const exit = { code: 0, signal: null } satisfies HermesTerminalExit
          for (const listener of session.exitListeners) {
            listener(exit)
          }
          ptySessions.delete(id)
        }
        ws.onerror = () => {
          const exit = { code: 1, signal: null } satisfies HermesTerminalExit
          for (const listener of session.exitListeners) {
            listener(exit)
          }
        }

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve()
          ws.onerror = () => reject(new Error('PTY WebSocket failed to open'))
        })

        if (options.cols && options.rows) {
          ws.send(`\x1b[RESIZE:${options.cols};${options.rows}]`)
        }

        return { id, cwd: session.cwd, shell: session.shell } satisfies HermesTerminalSession
      },
      write: async (id: string, data: string) => {
        const session = ptySessions.get(id)
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
          return false
        }
        session.ws.send(data)
        return true
      },
      resize: async (id: string, size: { cols: number; rows: number }) => {
        const session = ptySessions.get(id)
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
          return false
        }
        session.ws.send(`\x1b[RESIZE:${size.cols};${size.rows}]`)
        return true
      },
      dispose: async (id: string) => {
        const session = ptySessions.get(id)
        if (!session) {
          return false
        }
        session.ws.close()
        ptySessions.delete(id)
        return true
      },
      onData: (id: string, callback: (payload: string) => void) => {
        const session = ptySessions.get(id)
        if (!session) {
          return () => undefined
        }
        session.dataListeners.add(callback)
        return () => session.dataListeners.delete(callback)
      },
      onExit: (id: string, callback: (payload: HermesTerminalExit) => void) => {
        const session = ptySessions.get(id)
        if (!session) {
          return () => undefined
        }
        session.exitListeners.add(callback)
        return () => session.exitListeners.delete(callback)
      }
    },
    onPreviewFileChanged: (callback: (payload: HermesPreviewFileChanged) => void) => {
      previewListeners.add(callback)
      return () => previewListeners.delete(callback)
    },
    onBackendExit: (callback: (payload: BackendExit) => void) => {
      backendExitListeners.add(callback)
      return () => backendExitListeners.delete(callback)
    },
    onBootProgress: (callback: (payload: DesktopBootProgress) => void) => {
      bootListeners.add(callback)
      callback(bootProgress)
      return () => bootListeners.delete(callback)
    },
    getBootstrapState: async () =>
      ({
        active: false,
        manifest: null,
        stages: {},
        error: null,
        log: [],
        startedAt: null,
        completedAt: null,
        unsupportedPlatform: null
      }) satisfies DesktopBootstrapState,
    resetBootstrap: async () => ({ ok: true }),
    repairBootstrap: async () => ({ ok: true }),
    cancelBootstrap: async () => ({ ok: true, cancelled: false }),
    onBootstrapEvent: () => () => undefined,
    getVersion: async () =>
      ({
        appVersion: '0.1.0',
        electronVersion: 'n/a',
        nodeVersion: 'n/a',
        platform: 'web',
        hermesRoot: apiBaseUrl() || 'local'
      }) satisfies DesktopVersionInfo,
    updates: {
      check: async () =>
        ({
          supported: false,
          reason: 'Updates are managed via hermes update on the host machine.'
        }) satisfies DesktopUpdateStatus,
      apply: async () =>
        ({
          ok: false,
          manual: true,
          command: 'hermes update',
          message: 'Run hermes update on the machine hosting the Verxio runtime.'
        }) satisfies DesktopUpdateApplyResult,
      getBranch: async () => ({ branch: 'main' }),
      setBranch: async (name: string) => ({ branch: name }),
      onProgress: () => () => undefined
    }
  }

  void waitForDashboardReady()
    .then(() => {
      emitBoot({
        phase: 'backend.ready',
        message: 'Verxio backend is ready',
        progress: 100,
        running: false,
        error: null
      })
    })
    .catch(error => {
      emitBoot({
        phase: 'backend.error',
        message: error instanceof Error ? error.message : String(error),
        running: false,
        error: error instanceof Error ? error.message : String(error)
      })
    })
}
