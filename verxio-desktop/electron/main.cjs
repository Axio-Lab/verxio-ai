const {
  BrowserWindow,
  Menu,
  Notification,
  app,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  safeStorage,
  session,
  shell,
  systemPreferences
} = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { execFile, spawn } = require('node:child_process')

let nodePty = null
let nodePtyDir = null
let spawnHelperChecked = false

try {
  nodePty = require('node-pty')
  nodePtyDir = path.dirname(require.resolve('node-pty/package.json'))
} catch {
  console.warn('[verxio-desktop] node-pty unavailable; embedded terminal will be limited')
}

function ensureSpawnHelperExecutable() {
  if (spawnHelperChecked || IS_WINDOWS || !nodePtyDir) {
    return
  }

  spawnHelperChecked = true

  const candidates = [
    path.join(nodePtyDir, 'build', 'Release', 'spawn-helper'),
    path.join(nodePtyDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
  ]

  for (const helper of candidates) {
    try {
      const mode = fs.statSync(helper).mode

      if ((mode & 0o111) === 0) {
        fs.chmodSync(helper, mode | 0o755)
      }
    } catch {
      // Not present in this layout; skip.
    }
  }
}

const DEV_SERVER = process.env.VERXIO_DESKTOP_DEV_SERVER
const IS_MAC = process.platform === 'darwin'
const IS_WINDOWS = process.platform === 'win32'
const APP_ROOT = app.getAppPath()
const USER_DATA_OVERRIDE = process.env.VERXIO_DESKTOP_USER_DATA_DIR

if (USER_DATA_OVERRIDE) {
  const resolvedUserData = path.resolve(USER_DATA_OVERRIDE)
  fs.mkdirSync(resolvedUserData, { recursive: true })
  app.setPath('userData', resolvedUserData)
}

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')

let mainWindow = null
const terminalSessions = new Map()
const fileWatches = new Map()

const LEASH_AGENT_FILE = 'leash-agent.json'
const RUNTIME_WORKSPACE_ROOT = '/workspace'
const DESKTOP_WORKSPACE_NAME = 'Verxio'

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
  safeChmod(settingsPath())
}

function desktopWorkspaceCandidate() {
  return path.join(app.getPath('documents'), DESKTOP_WORKSPACE_NAME)
}

function ensureDesktopWorkspace() {
  const workspaceDir = desktopWorkspaceCandidate()

  fs.mkdirSync(workspaceDir, { recursive: true })

  const settings = readSettings()
  let created = false

  if (!settings.defaultProjectDir) {
    settings.defaultProjectDir = workspaceDir
    writeSettings(settings)
    created = true
  }

  grantPath(settings.defaultProjectDir || workspaceDir)

  return {
    created,
    dir: settings.defaultProjectDir || workspaceDir
  }
}

function defaultProjectDir() {
  return readSettings().defaultProjectDir || desktopWorkspaceCandidate()
}

function resolveLocalFsPath(inputPath) {
  const trimmed = String(inputPath || '').trim()

  if (!trimmed) {
    return defaultProjectDir()
  }

  if (trimmed === RUNTIME_WORKSPACE_ROOT || trimmed.startsWith(`${RUNTIME_WORKSPACE_ROOT}/`)) {
    const workspace = defaultProjectDir()

    if (trimmed === RUNTIME_WORKSPACE_ROOT) {
      return workspace
    }

    return path.join(workspace, trimmed.slice(RUNTIME_WORKSPACE_ROOT.length + 1))
  }

  return resolvePath(trimmed)
}

function safeChmod(filePath) {
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    // Best-effort on Windows and restricted filesystems.
  }
}

function resolvePath(value) {
  return path.resolve(String(value || ''))
}

function samePath(left, right) {
  return resolvePath(left).toLowerCase() === resolvePath(right).toLowerCase()
}

function uniquePaths(paths) {
  const result = []

  for (const value of paths) {
    if (!value) {
      continue
    }

    const resolved = resolvePath(value)

    if (!result.some(existing => samePath(existing, resolved))) {
      result.push(resolved)
    }
  }

  return result
}

function isSubPath(candidate, folder) {
  const resolvedCandidate = resolvePath(candidate)
  const resolvedFolder = resolvePath(folder)
  const relative = path.relative(resolvedFolder, resolvedCandidate)

  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function grantedFolders() {
  const settings = readSettings()
  const hasConfiguredFolders = Array.isArray(settings.grantedFolders)
  const configured = hasConfiguredFolders ? settings.grantedFolders : []
  const implicit = settings.defaultProjectDir
    ? [settings.defaultProjectDir]
    : hasConfiguredFolders
      ? []
      : [defaultProjectDir()]

  return uniquePaths([...configured, ...implicit])
}

function saveGrantedFolders(folders) {
  const settings = readSettings()
  settings.grantedFolders = uniquePaths(folders)
  writeSettings(settings)

  return settings.grantedFolders
}

function grantPath(targetPath) {
  const resolved = resolvePath(targetPath)
  let folder = resolved

  try {
    if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
      folder = path.dirname(resolved)
    }
  } catch {
    folder = path.dirname(resolved)
  }

  saveGrantedFolders([...grantedFolders(), folder])

  return folder
}

function revokeGrantedFolder(folder) {
  const resolved = resolvePath(folder)

  return saveGrantedFolders(grantedFolders().filter(existing => !samePath(existing, resolved)))
}

function isPathAllowed(filePath) {
  const resolved = resolveLocalFsPath(filePath)

  return grantedFolders().some(folder => isSubPath(resolved, folder))
}

function assertPathAllowed(filePath) {
  const resolved = resolveLocalFsPath(filePath)

  if (!isPathAllowed(resolved)) {
    const error = new Error(
      `Verxio Desktop has not been granted access to ${resolved}. Choose it with the file picker first.`
    )
    error.code = 'VERXIO_DESKTOP_PERMISSION_DENIED'
    throw error
  }

  return resolved
}

function leashAgentPath() {
  return path.join(app.getPath('userData'), LEASH_AGENT_FILE)
}

function readLeashAgent() {
  try {
    const parsed = JSON.parse(fs.readFileSync(leashAgentPath(), 'utf8'))

    if (parsed?.encoding === 'electron-safe-storage' && typeof parsed.ciphertext === 'string') {
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.ciphertext, 'base64'))

      return JSON.parse(decrypted)
    }

    if (parsed?.encoding === 'plain' && parsed.config && typeof parsed.config === 'object') {
      return parsed.config
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // Missing or unreadable identity file.
  }

  return null
}

function writeLeashAgent(config) {
  const filePath = leashAgentPath()

  if (!config) {
    try {
      fs.rmSync(filePath, { force: true })
    } catch {
      // ignore
    }

    return true
  }

  const json = JSON.stringify(config)
  const payload = safeStorage.isEncryptionAvailable()
    ? {
        version: 1,
        encoding: 'electron-safe-storage',
        ciphertext: safeStorage.encryptString(json).toString('base64')
      }
    : {
        version: 1,
        encoding: 'plain',
        config
      }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`)
  safeChmod(filePath)

  return true
}

function nativeOverlayWidth() {
  return IS_MAC ? 0 : 138
}

function windowButtonPosition() {
  return IS_MAC ? { x: 12, y: 12 } : null
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('verxio:window-state-changed', {
    isFullscreen: mainWindow.isFullScreen(),
    nativeOverlayWidth: nativeOverlayWidth(),
    windowButtonPosition: windowButtonPosition()
  })
}

function rendererUrl() {
  if (DEV_SERVER) {
    return DEV_SERVER
  }

  const dist = process.env.VERXIO_DESKTOP_WEB_DIST
    ? path.resolve(APP_ROOT, process.env.VERXIO_DESKTOP_WEB_DIST)
    : path.join(APP_ROOT, 'build/renderer')

  return pathToFileURL(path.join(dist, 'index.html')).toString()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#080e14' : '#eff9fd',
    height: 900,
    minHeight: 640,
    minWidth: 960,
    show: false,
    title: 'Verxio',
    titleBarOverlay: IS_MAC
      ? false
      : {
          color: '#00000000',
          height: 40,
          symbolColor: nativeTheme.shouldUseDarkColors ? '#dbeafe' : '#0f172a'
        },
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    trafficLightPosition: IS_MAC ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(APP_ROOT, 'electron/preload.cjs'),
      sandbox: false
    },
    width: 1440
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    sendWindowState()
  })

  mainWindow.on('enter-full-screen', sendWindowState)
  mainWindow.on('leave-full-screen', sendWindowState)
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)
  mainWindow.on('restore', sendWindowState)

  mainWindow.loadURL(rendererUrl())
}

function configureDisplayMediaCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          fetchWindowIcons: false,
          thumbnailSize: { height: 1, width: 1 },
          types: ['screen', 'window']
        })
        const screen = sources.find(source => /screen|entire/i.test(source.name)) || sources[0]

        if (!screen) {
          callback({})

          return
        }

        callback({
          video: request.videoRequested ? screen : undefined,
          audio: request.audioRequested && IS_WINDOWS ? 'loopback' : undefined
        })
      } catch {
        callback({})
      }
    },
    { useSystemPicker: true }
  )
}

function dataUrlForBuffer(buffer, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mime =
    {
      '.gif': 'image/gif',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.txt': 'text/plain',
      '.webp': 'image/webp'
    }[ext] || 'application/octet-stream'

  return `data:${mime};base64,${buffer.toString('base64')}`
}

function looksBinary(buffer) {
  if (!buffer.length) {
    return false
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  let suspicious = 0

  for (const byte of sample) {
    if (byte === 0) {
      return true
    }

    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      suspicious += 1
    }
  }

  return suspicious / sample.length > 0.12
}

function languageFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  return (
    {
      '.c': 'c',
      '.conf': 'ini',
      '.cpp': 'cpp',
      '.css': 'css',
      '.csv': 'csv',
      '.go': 'go',
      '.graphql': 'graphql',
      '.h': 'c',
      '.hpp': 'cpp',
      '.html': 'html',
      '.java': 'java',
      '.js': 'javascript',
      '.json': 'json',
      '.jsx': 'jsx',
      '.log': 'text',
      '.lua': 'lua',
      '.md': 'markdown',
      '.mjs': 'javascript',
      '.py': 'python',
      '.rb': 'ruby',
      '.rs': 'rust',
      '.sh': 'shell',
      '.sql': 'sql',
      '.svg': 'xml',
      '.toml': 'toml',
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.txt': 'text',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.zsh': 'shell'
    }[ext] || 'text'
  )
}

function basename(value) {
  return (
    String(value || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || String(value || '')
  )
}

function normalizePreviewTarget(rawTarget, baseDir) {
  const raw = String(rawTarget || '')
    .trim()
    .replace(/^`|`$/g, '')

  if (!raw) {
    return null
  }

  if (/^https?:\/\//i.test(raw)) {
    return { kind: 'url', label: basename(raw), source: raw, url: raw }
  }

  let filePath = raw

  if (/^file:\/\//i.test(raw)) {
    try {
      filePath = decodeURIComponent(new URL(raw).pathname)
    } catch {
      filePath = raw.replace(/^file:\/\//i, '')
    }
  } else if (!path.isAbsolute(raw) && baseDir) {
    filePath = path.resolve(resolveLocalFsPath(baseDir), raw)
  } else {
    filePath = resolveLocalFsPath(filePath)
  }

  const ext = path.extname(filePath).toLowerCase()
  const previewKind = ['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'].includes(ext)
    ? 'image'
    : ['.html', '.htm'].includes(ext)
      ? 'html'
      : 'text'

  return {
    kind: 'file',
    label: basename(filePath),
    language: languageFor(filePath),
    path: filePath,
    previewKind,
    source: raw,
    url: pathToFileURL(filePath).toString()
  }
}

function readDirForIpc(dirPath) {
  const resolved = assertPathAllowed(dirPath || defaultProjectDir())

  try {
    const entries = fs
      .readdirSync(resolved, { withFileTypes: true })
      .map(entry => ({
        name: entry.name,
        path: path.join(resolved, entry.name),
        isDirectory: entry.isDirectory()
      }))
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1
        }

        return left.name.localeCompare(right.name)
      })

    return { entries }
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function shellForPlatform() {
  if (IS_WINDOWS) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: [],
      name: 'cmd'
    }
  }

  const command = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const shellName = path.basename(command)
  const args = shellName.includes('zsh') || shellName.includes('bash') ? ['-il'] : ['-i']

  return {
    command,
    args,
    name: shellName
  }
}

function terminalShellEnv() {
  const env = { ...process.env }

  // Launched via `npm run desktop:dev` — do not leak npm prefix into the user's shell.
  for (const key of Object.keys(env)) {
    if (key === 'npm_config_prefix' || key.startsWith('npm_config_') || key.startsWith('npm_package_')) {
      delete env[key]
    }
  }

  delete env.NO_COLOR
  delete env.FORCE_COLOR
  delete env.COLORFGBG

  env.COLORTERM = 'truecolor'
  env.LC_CTYPE = env.LC_CTYPE || 'UTF-8'
  env.TERM = 'xterm-256color'
  env.TERM_PROGRAM = 'Verxio'
  env.TERM_PROGRAM_VERSION = app.getVersion()

  return env
}

function sendTerminalData(id, data) {
  const win = terminalSessions.get(id)?.window

  if (!win || win.isDestroyed()) {
    return
  }

  win.webContents.send(`verxio:terminal:${id}:data`, data)
}

function sendTerminalExit(id, exit) {
  const win = terminalSessions.get(id)?.window

  if (!win || win.isDestroyed()) {
    return
  }

  win.webContents.send(`verxio:terminal:${id}:exit`, exit)
}

function disposeTerminalSession(id) {
  const session = terminalSessions.get(id)

  if (!session) {
    return false
  }

  terminalSessions.delete(id)

  try {
    if (session.pty) {
      session.pty.kill()
    } else if (session.child) {
      session.child.kill()
    }
  } catch {
    // process may already be gone
  }

  return true
}

app.whenReady().then(() => {
  ensureDesktopWorkspace()
  Menu.setApplicationMenu(null)
  configureDisplayMediaCapture()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (!IS_MAC) {
    app.quit()
  }
})

app.on('before-quit', () => {
  for (const id of terminalSessions.keys()) {
    disposeTerminalSession(id)
  }

  for (const watch of fileWatches.values()) {
    watch.close()
  }

  fileWatches.clear()
})

powerMonitor.on('resume', () => {
  mainWindow?.webContents.send('verxio:power-resume')
})

ipcMain.handle('verxio:window:nativeOverlayWidth', () => nativeOverlayWidth())
ipcMain.handle('verxio:window:buttonPosition', () => windowButtonPosition())

ipcMain.handle('verxio:notify', (_event, payload = {}) => {
  if (!Notification.isSupported()) {
    return false
  }

  new Notification({
    body: payload.body || '',
    silent: Boolean(payload.silent),
    title: payload.title || 'Verxio'
  }).show()

  return true
})

ipcMain.handle('verxio:requestMicrophoneAccess', async () => {
  if (!IS_MAC) {
    return true
  }

  try {
    return await systemPreferences.askForMediaAccess('microphone')
  } catch {
    return false
  }
})

ipcMain.handle('verxio:audio:captureSupport', () => ({
  platform: process.platform,
  systemAudio: true,
  loopbackAudio: IS_WINDOWS,
  systemPicker: IS_MAC
}))

ipcMain.handle('verxio:readFileDataUrl', async (_event, filePath) => {
  const resolved = assertPathAllowed(filePath)
  const buffer = await fs.promises.readFile(resolved)

  return dataUrlForBuffer(buffer, resolved)
})

ipcMain.handle('verxio:readFileText', async (_event, filePath) => {
  const resolved = assertPathAllowed(filePath)
  const buffer = await fs.promises.readFile(resolved)

  return {
    binary: looksBinary(buffer),
    byteSize: buffer.byteLength,
    language: languageFor(resolved),
    path: resolved,
    text: buffer.toString('utf8')
  }
})

ipcMain.handle('verxio:selectPaths', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title,
    defaultPath: options.defaultPath || defaultProjectDir(),
    properties: [
      options.directories ? 'openDirectory' : 'openFile',
      options.multiple ? 'multiSelections' : null,
      'createDirectory'
    ].filter(Boolean),
    filters: Array.isArray(options.filters) ? options.filters : undefined
  })

  if (result.canceled) {
    return []
  }

  for (const selectedPath of result.filePaths) {
    grantPath(selectedPath)
  }

  return result.filePaths
})

ipcMain.handle('verxio:writeClipboard', (_event, text) => {
  clipboard.writeText(String(text || ''))

  return true
})

ipcMain.handle('verxio:saveImageFromUrl', async (_event, url) => {
  await shell.openExternal(String(url || ''))

  return true
})

ipcMain.handle('verxio:saveImageBuffer', async (_event, payload = {}) => {
  const ext = String(payload.ext || 'png').replace(/^\./, '') || 'png'
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('downloads'), `verxio-image.${ext}`)
  })

  if (result.canceled || !result.filePath) {
    return ''
  }

  const data = Buffer.from(payload.data || [])
  await fs.promises.writeFile(result.filePath, data)

  return result.filePath
})

ipcMain.handle('verxio:saveClipboardImage', async () => {
  const image = clipboard.readImage()

  if (image.isEmpty()) {
    return ''
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('downloads'), 'verxio-clipboard.png')
  })

  if (result.canceled || !result.filePath) {
    return ''
  }

  await fs.promises.writeFile(result.filePath, image.toPNG())

  return result.filePath
})

ipcMain.handle('verxio:normalizePreviewTarget', (_event, target, baseDir) =>
  normalizePreviewTarget(target, baseDir ? String(baseDir) : '')
)

ipcMain.handle('verxio:watchPreviewFile', (_event, url) => {
  const target = normalizePreviewTarget(url)

  if (!target?.path) {
    const id = crypto.randomUUID()

    return { id, path: String(url || '') }
  }

  assertPathAllowed(target.path)

  const id = crypto.randomUUID()
  const watch = fs.watch(target.path, { persistent: false }, () => {
    mainWindow?.webContents.send('verxio:preview-file-changed', { id, path: target.path, url: target.url })
  })

  fileWatches.set(id, watch)

  return { id, path: target.path }
})

ipcMain.handle('verxio:stopPreviewFileWatch', (_event, id) => {
  const watch = fileWatches.get(String(id || ''))

  if (!watch) {
    return false
  }

  watch.close()
  fileWatches.delete(String(id || ''))

  return true
})

ipcMain.on('verxio:titlebar-theme', (_event, payload = {}) => {
  if (!mainWindow || IS_MAC) {
    return
  }

  mainWindow.setTitleBarOverlay({
    color: payload.background || '#00000000',
    height: 40,
    symbolColor: payload.foreground || (nativeTheme.shouldUseDarkColors ? '#dbeafe' : '#0f172a')
  })
})

ipcMain.on('verxio:previewShortcutActive', () => {
  // Reserved for native menu shortcuts in the packaged phase.
})

ipcMain.handle('verxio:openExternal', async (_event, url) => {
  await shell.openExternal(String(url || ''))
})

ipcMain.handle('verxio:workspace:ensure', () => ensureDesktopWorkspace())

ipcMain.handle('verxio:setting:defaultProjectDir:get', () => ({
  defaultLabel: 'Project directory',
  dir: ensureDesktopWorkspace().dir
}))

ipcMain.handle('verxio:setting:defaultProjectDir:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: defaultProjectDir(),
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose default project directory'
  })

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, dir: null }
  }

  const settings = readSettings()
  settings.defaultProjectDir = result.filePaths[0]
  grantPath(result.filePaths[0])
  writeSettings(settings)

  return { canceled: false, dir: result.filePaths[0] }
})

ipcMain.handle('verxio:setting:defaultProjectDir:set', (_event, dir) => {
  const settings = readSettings()

  if (dir) {
    settings.defaultProjectDir = String(dir)
    grantPath(dir)
  } else {
    delete settings.defaultProjectDir
  }

  writeSettings(settings)

  return { dir: settings.defaultProjectDir || null }
})

ipcMain.handle('verxio:logs:reveal', async () => {
  const logPath = app.getPath('logs')
  await shell.openPath(logPath)

  return { ok: true, path: logPath }
})

ipcMain.handle('verxio:logs:recent', () => ({ path: app.getPath('logs'), lines: [] }))

ipcMain.handle('verxio:fs:readDir', (_event, dirPath) => {
  try {
    return readDirForIpc(dirPath)
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('verxio:fs:gitRoot', (_event, startPath) => {
  try {
    const cwd = assertPathAllowed(startPath || defaultProjectDir())

    return new Promise(resolve => {
      execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { windowsHide: true }, (error, stdout) => {
        resolve(error ? null : stdout.trim() || null)
      })
    })
  } catch {
    return null
  }
})

ipcMain.handle('verxio:fs:permissions:list', () => ({ folders: grantedFolders() }))
ipcMain.handle('verxio:fs:permissions:grantFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: defaultProjectDir(),
    properties: ['openDirectory', 'createDirectory'],
    title: 'Grant Verxio access to a folder'
  })

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, folders: grantedFolders() }
  }

  grantPath(result.filePaths[0])

  return { canceled: false, folders: grantedFolders() }
})
ipcMain.handle('verxio:fs:permissions:revokeFolder', (_event, folder) => ({
  folders: revokeGrantedFolder(folder)
}))
ipcMain.handle('verxio:fs:permissions:isAllowed', (_event, targetPath) => ({
  allowed: isPathAllowed(targetPath),
  path: resolvePath(targetPath)
}))

ipcMain.handle('verxio:leash:getAgent', () => readLeashAgent())
ipcMain.handle('verxio:leash:setAgent', (_event, config) => writeLeashAgent(config || null))
ipcMain.handle('verxio:leash:clearAgent', () => writeLeashAgent(null))
ipcMain.handle('verxio:leash:getBannerNeverShow', () => readSettings().leashBannerNeverShow === true)
ipcMain.handle('verxio:leash:setBannerNeverShow', (_event, value) => {
  const settings = readSettings()

  if (value) {
    settings.leashBannerNeverShow = true
  } else {
    delete settings.leashBannerNeverShow
  }

  writeSettings(settings)

  return true
})

ipcMain.handle('verxio:terminal:start', (event, options = {}) => {
  const id = crypto.randomUUID()
  const shellConfig = shellForPlatform()
  const resolvedCwd = options.cwd ? resolveLocalFsPath(options.cwd) : defaultProjectDir()
  const cwd = fs.existsSync(resolvedCwd) ? resolvedCwd : defaultProjectDir()
  const cols = Math.max(2, Number.parseInt(String(options.cols || 80), 10) || 80)
  const rows = Math.max(2, Number.parseInt(String(options.rows || 24), 10) || 24)
  const sender = event.sender

  if (nodePty) {
    ensureSpawnHelperExecutable()

    const ptyProcess = nodePty.spawn(shellConfig.command, shellConfig.args, {
      cols,
      cwd,
      env: terminalShellEnv(),
      name: 'xterm-256color',
      rows
    })

    terminalSessions.set(id, { pty: ptyProcess, window: BrowserWindow.fromWebContents(sender) })

    ptyProcess.onData(data => sendTerminalData(id, data))
    ptyProcess.onExit(({ exitCode, signal }) => {
      sendTerminalExit(id, { code: exitCode, signal: signal || null })
      terminalSessions.delete(id)
    })

    return {
      cwd,
      id,
      shell: shellConfig.name
    }
  }

  const child = spawn(shellConfig.command, shellConfig.args, {
    cwd,
    env: terminalShellEnv(),
    stdio: 'pipe',
    windowsHide: true
  })

  terminalSessions.set(id, { child, window: BrowserWindow.fromWebContents(sender) })

  child.stdout.on('data', chunk => sendTerminalData(id, chunk.toString()))
  child.stderr.on('data', chunk => sendTerminalData(id, chunk.toString()))
  child.on('exit', (code, signal) => {
    sendTerminalExit(id, { code, signal })
    terminalSessions.delete(id)
  })
  child.on('error', error => {
    sendTerminalData(id, `Terminal failed: ${error.message}\r\n`)
    sendTerminalExit(id, { code: 1, signal: null })
    terminalSessions.delete(id)
  })

  return {
    cwd,
    id,
    shell: shellConfig.name
  }
})

ipcMain.handle('verxio:terminal:write', (_event, id, data) => {
  const session = terminalSessions.get(String(id || ''))

  if (session?.pty) {
    session.pty.write(String(data || ''))

    return true
  }

  if (!session?.child.stdin?.writable) {
    return false
  }

  session.child.stdin.write(String(data || ''))

  return true
})

ipcMain.handle('verxio:terminal:resize', (_event, id, size = {}) => {
  const session = terminalSessions.get(String(id || ''))

  if (!session?.pty) {
    return true
  }

  const cols = Math.max(2, Number.parseInt(String(size.cols || 80), 10) || 80)
  const rows = Math.max(2, Number.parseInt(String(size.rows || 24), 10) || 24)

  session.pty.resize(cols, rows)

  return true
})
ipcMain.handle('verxio:terminal:dispose', (_event, id) => disposeTerminalSession(String(id || '')))

ipcMain.handle('verxio:version', () => ({
  appVersion: app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  platform: process.platform,
  hermesRoot: process.env.VERXIO_API_URL || process.env.VITE_VERXIO_API_URL || 'http://127.0.0.1:8787'
}))

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)

    return { action: 'deny' }
  })
})
