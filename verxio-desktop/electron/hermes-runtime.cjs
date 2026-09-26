const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const READY_RE = /^HERMES_DASHBOARD_READY port=(\d+)/m
const DEFAULT_PORT_ANNOUNCE_TIMEOUT_MS = 90_000
const MIN_PORT_ANNOUNCE_TIMEOUT_MS = 45_000

function parseReadyLine(line) {
  const match = String(line || '').match(READY_RE)
  return match ? Number.parseInt(match[1], 10) : null
}

function resolvePortAnnounceTimeoutMs(env = process.env) {
  const parsed = Number(env.HERMES_DESKTOP_PORT_ANNOUNCE_TIMEOUT_MS)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(MIN_PORT_ANNOUNCE_TIMEOUT_MS, Math.round(parsed))
  }
  return DEFAULT_PORT_ANNOUNCE_TIMEOUT_MS
}

function waitForDashboardPort(child, timeoutMs = resolvePortAnnounceTimeoutMs()) {
  return new Promise((resolve, reject) => {
    let buf = ''
    let done = false

    function cleanup() {
      if (done) return
      done = true
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    function onData(chunk) {
      buf += chunk.toString()
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const port = parseReadyLine(line)
        if (port) {
          cleanup()
          resolve(port)
        }
      }
    }

    function onExit(code, signal) {
      cleanup()
      reject(new Error(`Hermes backend exited before port announcement (${signal || code})`))
    }

    function onError(err) {
      cleanup()
      reject(err)
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for Hermes backend port announcement (${timeoutMs}ms)`))
    }, timeoutMs)

    child.stdout?.on('data', onData)
    child.on('exit', onExit)
    child.on('error', onError)
  })
}

function fileExists(target) {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

function directoryExists(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function isHermesSourceRoot(root) {
  return directoryExists(root) && fileExists(path.join(root, 'hermes_cli', 'main.py'))
}

function resolveHermesSource(options = {}) {
  const env = options.env || process.env
  const appRoot = options.appRoot || process.cwd()
  const userData = options.userData || ''
  const candidates = [
    env.HERMES_DESKTOP_HERMES_ROOT,
    env.VERXIO_HERMES_ROOT,
    path.join(appRoot, '..', 'hermes-agent'),
    path.join(appRoot, 'hermes-agent'),
    userData ? path.join(userData, 'hermes-agent') : '',
    path.join(process.env.HOME || '', '.hermes', 'hermes-agent')
  ]

  for (const candidate of candidates) {
    if (candidate && isHermesSourceRoot(path.resolve(candidate))) {
      return path.resolve(candidate)
    }
  }

  return null
}

function resolvePython(root) {
  const binary = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  const candidates = [path.join(root, '.venv', binary), path.join(root, 'venv', binary)]

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate
    }
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

function createRuntime(options = {}) {
  const send = options.send || (() => {})
  const rememberLog = options.rememberLog || (() => {})
  const state = {
    child: null,
    port: null,
    token: null,
    baseUrl: null,
    stopping: false,
    restarts: 0,
    logs: []
  }

  function emit(channel, payload) {
    try {
      send(channel, payload)
    } catch {
      // window may already be gone
    }
  }

  function log(line) {
    const text = String(line || '').trim()
    if (!text) return
    state.logs.push(text)
    if (state.logs.length > 200) {
      state.logs.splice(0, state.logs.length - 200)
    }
    rememberLog(text)
  }

  function connection() {
    if (!state.port || !state.token) {
      return null
    }
    return {
      baseUrl: `http://127.0.0.1:${state.port}`,
      token: state.token,
      port: state.port
    }
  }

  async function spawnOnce() {
    const root = resolveHermesSource(options)
    if (!root) {
      throw new Error('Hermes source was not found. Set VERXIO_HERMES_ROOT or install Hermes on first launch.')
    }

    const hermesHome = options.hermesHome || path.join(options.userData || process.cwd(), 'hermes-home')
    fs.mkdirSync(hermesHome, { recursive: true })
    const token = crypto.randomBytes(24).toString('hex')
    const python = resolvePython(root)
    const workspaceCwd = options.workspaceCwd && directoryExists(options.workspaceCwd) ? options.workspaceCwd : root
    const env = {
      ...process.env,
      HERMES_HOME: hermesHome,
      HERMES_DASHBOARD_SESSION_TOKEN: token,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: [root, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter),
      TERMINAL_CWD: workspaceCwd,
      VERXIO_DESKTOP: '1',
      VERXIO_HOSTED: process.env.VERXIO_HOSTED || '0'
    }

    emit('verxio:boot-progress', {
      phase: 'backend.spawn',
      message: 'Starting your agent…',
      progress: 40,
      running: true
    })

    const child = spawn(
      python,
      ['-m', 'hermes_cli.main', 'dashboard', '--no-open', '--host', '127.0.0.1', '--port', '9119'],
      {
        cwd: workspaceCwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    state.child = child
    state.token = token
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => log(chunk))
    child.stderr?.on('data', chunk => log(chunk))

    const port = await waitForDashboardPort(child).catch(error => {
      const detail = state.logs.slice(-4).filter(Boolean).join(' | ')

      if (!detail) {
        throw error
      }

      throw new Error(`${error.message}: ${detail}`)
    })
    state.port = port
    state.baseUrl = `http://127.0.0.1:${port}`
    emit('verxio:boot-progress', {
      phase: 'backend.ready',
      message: 'Verxio is ready',
      progress: 94,
      running: false
    })
    return connection()
  }

  async function start() {
    state.stopping = false
    try {
      return await spawnOnce()
    } catch (error) {
      emit('verxio:boot-progress', {
        phase: 'backend.error',
        message: error.message,
        progress: 20,
        running: false,
        error: error.message
      })
      throw error
    }
  }

  function stop() {
    state.stopping = true
    if (state.child && !state.child.killed) {
      state.child.kill('SIGTERM')
    }
    state.child = null
    state.port = null
    emit('verxio:backend-exit', { code: 0 })
  }

  function attachRestart() {
    if (!state.child) return
    state.child.on('exit', code => {
      emit('verxio:backend-exit', { code })
      if (state.stopping || state.restarts >= 5) {
        return
      }
      state.restarts += 1
      const delay = Math.min(15_000, 500 * 2 ** state.restarts)
      setTimeout(() => {
        if (!state.stopping) {
          start().catch(error => log(error.message))
        }
      }, delay)
    })
  }

  return {
    attachRestart,
    connection,
    logs: () => state.logs.slice(),
    parseReadyLine,
    resolveHermesSource,
    start,
    stop,
    waitForDashboardPort
  }
}

module.exports = {
  createRuntime,
  parseReadyLine,
  resolveHermesSource,
  resolvePortAnnounceTimeoutMs,
  resolvePython,
  waitForDashboardPort
}
