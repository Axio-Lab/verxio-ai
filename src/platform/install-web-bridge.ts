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
  DesktopUpdateApplyResult,
  DesktopUpdateStatus,
  DesktopVersionInfo,
  HermesApiRequest,
  HermesConnection,
  HermesNotification,
  HermesPreviewFileChanged,
  HermesPreviewWatch,
  HermesReadDirResult,
  HermesReadFileTextResult,
  HermesSelectPathsOptions,
  HermesTerminalExit,
  HermesTerminalSession
} from '@/global'
import { verxioApiBaseUrl, verxioApiEnabled, verxioApiUrl } from '@/lib/verxio-api'
import {
  getStoredWebLocalRoot,
  isWebLocalPath,
  pickBrowserLocalFolder,
  readWebLocalDir,
  readWebLocalFileText,
  restoreRootHandle,
  WEB_LOCAL_STORAGE_KEY
} from '@/lib/web-local-fs'
import { $currentCwd, setCurrentCwd } from '@/store/session'

declare global {
  interface Window {
    __VERXIO_WEB__?: boolean
  }
}

const CONNECTION_CONFIG_KEY = 'verxio.connection.config'
const ACTIVE_PROFILE_KEY = 'verxio.active.profile'

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

function hermesDashboardBaseUrl(): string {
  return import.meta.env.VITE_HERMES_DASHBOARD_URL?.replace(/\/$/, '') ?? ''
}

function buildApiUrl(path: string): string {
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

function buildWsUrl(path: string, params: Record<string, string>): string {
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

function authHeaders(): HeadersInit {
  if (verxioApiEnabled()) {
    return {}
  }

  const token = getToken()

  if (!token) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
    'X-Hermes-Session-Token': token
  }
}

function fetchCredentials(): RequestCredentials {
  return verxioApiEnabled() ? 'include' : 'same-origin'
}

const SESSION_TOKEN_RE = /window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/
const TOKEN_RELOAD_KEY = 'verxio.tokenReloadAttempted'

function dashboardOrigin(): string {
  if (verxioApiEnabled()) {
    const base = verxioApiBaseUrl()

    if (base) {
      return base.replace(/\/$/, '')
    }

    return window.location.origin
  }

  return import.meta.env.VITE_HERMES_DASHBOARD_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:9119'
}

async function refreshSessionToken(): Promise<boolean> {
  if (verxioApiEnabled()) {
    return false
  }

  try {
    const res = await fetch(`${dashboardOrigin()}/`, { headers: { accept: 'text/html' } })
    const html = await res.text()
    const match = html.match(SESSION_TOKEN_RE)

    if (!match?.[1]) {
      return false
    }

    window.__HERMES_SESSION_TOKEN__ = match[1]

    return true
  } catch {
    return false
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  options?: { allowUnauthorized?: boolean }
): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000)

  try {
    return await fetch(url, {
      ...init,
      credentials: fetchCredentials(),
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init.headers ?? {})
      }
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let res = await requestJson(url, init)

  if (res.status === 401) {
    const refreshed = await refreshSessionToken()

    if (refreshed) {
      res = await requestJson(url, init)
    }

    if (res.status === 401) {
      let alreadyReloaded = false

      try {
        alreadyReloaded = sessionStorage.getItem(TOKEN_RELOAD_KEY) === '1'
      } catch {
        /* privacy mode */
      }

      if (!alreadyReloaded) {
        try {
          sessionStorage.setItem(TOKEN_RELOAD_KEY, '1')
        } catch {
          /* privacy mode */
        }

        window.location.reload()

        return new Promise<T>(() => {})
      }
    }
  }

  if (res.ok) {
    try {
      sessionStorage.removeItem(TOKEN_RELOAD_KEY)
    } catch {
      /* privacy mode */
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}

async function pickDirectoryPaths(): Promise<string[]> {
  const browserPath = await pickBrowserLocalFolder()

  if (!browserPath) {
    return []
  }

  localStorage.setItem(WEB_LOCAL_STORAGE_KEY, browserPath)

  return [browserPath]
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
      const res = await fetch(buildApiUrl('/api/status'), {
        credentials: fetchCredentials(),
        headers: authHeaders()
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
    throw new Error(
      'Verxio agent runtime is not reachable. Sign in, then wait for verxio-api to start your isolated Hermes container (docker ps --filter name=verxio-).'
    )
  }

  throw new Error('Verxio backend is not reachable. Start it with: hermes dashboard --no-open')
}

async function getConnection(): Promise<HermesConnection> {
  await waitForDashboardReady()
  const token = verxioApiEnabled() ? 'verxio-proxy' : getToken()

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

  const baseUrl = verxioApiEnabled()
    ? verxioApiUrl('/api/runtime/dashboard')
    : hermesDashboardBaseUrl() || window.location.origin

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
      if (!navigator.mediaDevices?.getUserMedia) {
        return false
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())

        return true
      } catch (error) {
        console.warn('[verxio] Microphone permission denied or unavailable:', error)

        return false
      }
    },
    readFileDataUrl: async () => {
      throw new Error('File preview is not available in Verxio Web yet.')
    },
    readFileText: async (filePath: string) => {
      const local = await readWebLocalFileText(filePath)

      if (local) {
        return local
      }

      return {
        path: filePath,
        text: '',
        binary: true
      } satisfies HermesReadFileTextResult
    },
    selectPaths: async (options?: HermesSelectPathsOptions) => {
      if (options?.directories) {
        return pickDirectoryPaths()
      }

      if ('showOpenFilePicker' in window) {
        try {
          const handles = await (
            window as Window & {
              showOpenFilePicker: (opts?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>
            }
          ).showOpenFilePicker({ multiple: Boolean(options?.multiple) })

          return handles.map(handle => handle.name)
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return []
          }
        }
      }

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
        dir: localStorage.getItem(WEB_LOCAL_STORAGE_KEY)
      }),
      pickDefaultProjectDir: async () => {
        const paths = await pickDirectoryPaths()

        if (!paths[0]) {
          return { canceled: true, dir: null }
        }

        return { canceled: false, dir: paths[0] }
      },
      setDefaultProjectDir: async (dir: string | null) => {
        if (dir) {
          localStorage.setItem(WEB_LOCAL_STORAGE_KEY, dir)
        } else {
          localStorage.removeItem(WEB_LOCAL_STORAGE_KEY)
        }

        return { dir }
      }
    },
    revealLogs: async () => ({ ok: false, path: '', error: 'Logs are on the Verxio host machine.' }),
    getRecentLogs: async () => ({ path: '', lines: [] }),
    readDir: async (dirPath: string) => {
      if (isWebLocalPath(dirPath)) {
        return readWebLocalDir(dirPath)
      }

      const params = new URLSearchParams({ path: dirPath })
      const url = buildApiUrl(`/api/fs/readdir?${params.toString()}`)

      try {
        const res = await fetch(url, {
          credentials: fetchCredentials(),
          headers: authHeaders()
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')

          if (res.status === 404 && text.includes('No such API endpoint')) {
            return {
              entries: [],
              error: 'Restart the Verxio backend (hermes dashboard) to enable file browsing, then refresh this page.'
            } satisfies HermesReadDirResult
          }

          if (res.status === 401) {
            return {
              entries: [],
              error: 'Session expired. Refresh this page after the Verxio backend is running.'
            } satisfies HermesReadDirResult
          }

          return {
            entries: [],
            error: text || `${res.status} ${res.statusText}`
          } satisfies HermesReadDirResult
        }

        return (await res.json()) as HermesReadDirResult
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
        appVersion: '',
        electronVersion: 'n/a',
        nodeVersion: 'n/a',
        platform: 'web',
        hermesRoot: verxioApiEnabled() ? verxioApiUrl('/api/runtime/dashboard') : hermesDashboardBaseUrl() || 'local'
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

  void (async () => {
    const saved = getStoredWebLocalRoot()

    if (!saved) {
      return
    }

    await restoreRootHandle()

    if (!isWebLocalPath($currentCwd.get())) {
      setCurrentCwd(saved)
    }
  })()

  // Hosted Verxio checks /api/runtime/dashboard/* only after login (cookie required).
  // Probing here before auth always 401s and surfaces a false "backend down" error.
  if (!verxioApiEnabled()) {
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
}
