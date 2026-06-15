const {
  BrowserWindow,
  Menu,
  Notification,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  shell,
  systemPreferences
} = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { execFile, spawn } = require('node:child_process')

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
}

function defaultProjectDir() {
  return readSettings().defaultProjectDir || app.getPath('documents') || os.homedir()
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
    : path.resolve(APP_ROOT, '../verxio-web/dist')

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
    filePath = path.resolve(baseDir, raw)
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
  const resolved = path.resolve(String(dirPath || ''))

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
      args: ['/Q'],
      name: 'cmd'
    }
  }

  const command = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')

  return {
    command,
    args: ['-i'],
    name: path.basename(command)
  }
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
    session.child.kill()
  } catch {
    // process may already be gone
  }

  return true
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
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

ipcMain.handle('verxio:readFileDataUrl', async (_event, filePath) => {
  const resolved = path.resolve(String(filePath || ''))
  const buffer = await fs.promises.readFile(resolved)

  return dataUrlForBuffer(buffer, resolved)
})

ipcMain.handle('verxio:readFileText', async (_event, filePath) => {
  const resolved = path.resolve(String(filePath || ''))
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

  return result.canceled ? [] : result.filePaths
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

ipcMain.handle('verxio:setting:defaultProjectDir:get', () => ({
  defaultLabel: 'Project directory',
  dir: readSettings().defaultProjectDir || null
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
  writeSettings(settings)

  return { canceled: false, dir: result.filePaths[0] }
})

ipcMain.handle('verxio:setting:defaultProjectDir:set', (_event, dir) => {
  const settings = readSettings()

  if (dir) {
    settings.defaultProjectDir = String(dir)
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

ipcMain.handle('verxio:fs:readDir', (_event, dirPath) => readDirForIpc(dirPath))

ipcMain.handle('verxio:fs:gitRoot', (_event, startPath) => {
  const cwd = path.resolve(String(startPath || defaultProjectDir()))

  return new Promise(resolve => {
    execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null)
    })
  })
})

ipcMain.handle('verxio:terminal:start', (event, options = {}) => {
  const id = crypto.randomUUID()
  const shellConfig = shellForPlatform()
  const cwd = options.cwd && fs.existsSync(options.cwd) ? path.resolve(options.cwd) : defaultProjectDir()
  const child = spawn(shellConfig.command, shellConfig.args, {
    cwd,
    env: process.env,
    stdio: 'pipe',
    windowsHide: true
  })

  terminalSessions.set(id, { child, window: BrowserWindow.fromWebContents(event.sender) })

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

  if (!session?.child.stdin?.writable) {
    return false
  }

  session.child.stdin.write(String(data || ''))

  return true
})

ipcMain.handle('verxio:terminal:resize', () => true)
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
