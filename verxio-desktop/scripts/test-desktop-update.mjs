import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.resolve(desktopRoot, '../verxio-web')
const smokeRoot = path.join(desktopRoot, 'release', 'update-smoke')
// ShipIt renames the running bundle. On the Desktop that rename blocks in file
// coordination, so the launched copy lives on the local temp volume.
const launchedRoot = path.join(os.tmpdir(), 'verxio-update-smoke')
const launchedApp = path.join(launchedRoot, 'Verxio.app')
const pkgPath = path.join(desktopRoot, 'package.json')
const identityName = 'Verxio Update Smoke'
const keychainPassword = 'verxio-smoke'
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'

const require = createRequire(import.meta.url)

if (process.platform !== 'darwin') {
  console.error('test:update builds and relaunches a Mac app. Run it on macOS.')
  process.exit(1)
}

const originalPkg = fs.readFileSync(pkgPath, 'utf8')
const loginKeychain = spawnSync('security', ['default-keychain'], { encoding: 'utf8' }).stdout.replace(/"/g, '').trim()
const originalKeychains = keychainList()

let feedServer = null
let keychain = ''
let appProcess = null
let cleaned = false

function keychainList() {
  const output = spawnSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' }).stdout || ''

  return output
    .split('\n')
    .map(line => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || desktopRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: 'inherit'
    })

    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()

        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })

  return `${result.stdout || ''}${result.stderr || ''}`.trim()
}

function restorePackageJson() {
  fs.writeFileSync(pkgPath, originalPkg)
}

function cleanup() {
  if (cleaned) {
    return
  }

  cleaned = true
  restorePackageJson()

  if (feedServer) {
    feedServer.close()
  }

  if (appProcess && appProcess.exitCode === null && !appProcess.killed) {
    appProcess.kill('SIGTERM')
  }

  for (const pid of pidsFor(launchedApp)) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }

  if (originalKeychains.length > 0) {
    spawnSync('security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains])
  }

  if (keychain) {
    spawnSync('security', ['delete-keychain', keychain])
  }

  spawnSync('security', ['delete-certificate', '-c', identityName, loginKeychain])
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(1)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(1)
})

function pidsFor(fragment) {
  const output = commandOutput('ps', ['-ax', '-o', 'pid=,command='])

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes(fragment))
    .map(line => Number(line.split(/\s+/)[0]))
    .filter(pid => Number.isInteger(pid) && pid > 0)
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => (error ? reject(error) : resolve(port)))
    })
  })
}

function createSigningIdentity() {
  fs.mkdirSync(path.join(smokeRoot, 'certs'), { recursive: true })
  const certDir = path.join(smokeRoot, 'certs')
  const configPath = path.join(certDir, 'codesign.cnf')
  const certPath = path.join(certDir, 'cert.pem')
  const keyPath = path.join(certDir, 'key.pem')
  const p12Path = path.join(certDir, 'cert.p12')

  fs.writeFileSync(
    configPath,
    [
      '[req]',
      'distinguished_name=dn',
      'x509_extensions=codesign',
      'prompt=no',
      '[dn]',
      `CN=${identityName}`,
      '[codesign]',
      'keyUsage=critical,digitalSignature,keyCertSign',
      'extendedKeyUsage=critical,codeSigning',
      'basicConstraints=critical,CA:TRUE',
      'subjectKeyIdentifier=hash',
      'authorityKeyIdentifier=keyid:always',
      ''
    ].join('\n')
  )

  const generated = spawnSync(
    'openssl',
    [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-x509',
      '-days',
      '2',
      '-nodes',
      '-config',
      configPath,
      '-keyout',
      keyPath,
      '-out',
      certPath
    ],
    { stdio: 'inherit' }
  )

  if (generated.status !== 0) {
    throw new Error('Could not create the smoke-test signing certificate.')
  }

  const exported = spawnSync(
    'openssl',
    [
      'pkcs12',
      '-export',
      '-legacy',
      '-name',
      identityName,
      '-certpbe',
      'PBE-SHA1-3DES',
      '-keypbe',
      'PBE-SHA1-3DES',
      '-macalg',
      'sha1',
      '-out',
      p12Path,
      '-inkey',
      keyPath,
      '-in',
      certPath,
      '-passout',
      `pass:${keychainPassword}`
    ],
    { stdio: 'inherit' }
  )

  if (exported.status !== 0) {
    throw new Error('Could not export the smoke-test signing certificate.')
  }

  const trusted = spawnSync('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', loginKeychain, certPath], {
    encoding: 'utf8'
  })

  if (trusted.status !== 0) {
    throw new Error(`Could not trust the smoke-test certificate.\n${trusted.stderr || trusted.stdout}`)
  }

  keychain = path.join(certDir, 'verxio-update.keychain-db')
  spawnSync('security', ['delete-keychain', keychain])
  mustStatus(spawnSync('security', ['create-keychain', '-p', keychainPassword, keychain]), 'create-keychain')
  mustStatus(spawnSync('security', ['set-keychain-settings', '-lut', '3600', keychain]), 'set-keychain-settings')
  mustStatus(spawnSync('security', ['unlock-keychain', '-p', keychainPassword, keychain]), 'unlock-keychain')
  mustStatus(
    spawnSync('security', [
      'import',
      p12Path,
      '-k',
      keychain,
      '-P',
      keychainPassword,
      '-f',
      'pkcs12',
      '-A',
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/security'
    ]),
    'import identity'
  )
  mustStatus(
    spawnSync('security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      keychainPassword,
      keychain
    ]),
    'set-key-partition-list'
  )
  mustStatus(
    spawnSync('security', ['list-keychains', '-d', 'user', '-s', keychain, ...originalKeychains]),
    'list-keychains'
  )

  const identities = commandOutput('security', ['find-identity', '-v', '-p', 'codesigning'])

  if (!identities.includes(identityName)) {
    throw new Error(`The smoke-test identity is not valid.\n${identities}`)
  }

  return { p12Path }
}

function mustStatus(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stderr || result.stdout || ''}`)
  }
}

function signatureText(appPath) {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' })

  return `${result.stdout || ''}\n${result.stderr || ''}`
}

function ensureSigned(appPath) {
  const current = signatureText(appPath)

  if (current.includes(`Authority=${identityName}`)) {
    return false
  }

  console.log(`[update-smoke] signing ${appPath}`)
  mustStatus(
    spawnSync(
      'codesign',
      ['--force', '--deep', '--timestamp=none', '--sign', identityName, '--keychain', keychain, appPath],
      {
        encoding: 'utf8'
      }
    ),
    `codesign ${appPath}`
  )
  mustStatus(spawnSync('codesign', ['--verify', '--verbose=2', appPath], { encoding: 'utf8' }), `verify ${appPath}`)

  return true
}

function findByExtension(dir, extension) {
  const hits = []

  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)

      if (entry.isDirectory()) {
        if (!entry.name.endsWith('.app')) {
          walk(full)
        } else if (extension === '.app') {
          hits.push(full)
        }

        continue
      }

      if (entry.name.endsWith(extension)) {
        hits.push(full)
      }
    }
  }

  walk(dir)

  return hits
}

function fileSha512(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512')
    fs.createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')))
  })
}

async function writeLatestMacYml(zipPath) {
  const name = path.basename(zipPath)
  const sha512 = await fileSha512(zipPath)
  const size = fs.statSync(zipPath).size
  const ymlPath = path.join(path.dirname(zipPath), 'latest-mac.yml')
  const body = [
    'version: 0.0.2',
    'files:',
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n')

  fs.writeFileSync(ymlPath, body)

  return ymlPath
}

function zipApp(appPath, zipPath) {
  fs.rmSync(zipPath, { force: true })
  mustStatus(spawnSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { encoding: 'utf8' }), 'ditto zip')
}

async function buildRenderer() {
  const rendererDir = path.join(smokeRoot, 'renderer')
  const packagedRenderer = path.join(desktopRoot, 'build', 'renderer')

  await run('npm', ['exec', '--', 'tsc', '--noEmit'], {
    cwd: webRoot,
    env: { VITE_VERXIO_API_ENABLED: 'false', VITE_BASE: './' }
  })
  await run('npm', ['exec', '--', 'vite', 'build', '--outDir', rendererDir, '--emptyOutDir'], {
    cwd: webRoot,
    env: { VITE_VERXIO_API_ENABLED: 'false', VITE_BASE: './' }
  })
  fs.rmSync(packagedRenderer, { recursive: true, force: true })
  fs.cpSync(rendererDir, packagedRenderer, { recursive: true })
}

function writePackageFor(version, feedUrl, target) {
  const pkg = JSON.parse(originalPkg)

  pkg.version = version
  pkg.verxioUpdateSmoke = true
  pkg.build.appId = 'ai.verxio.desktop.update-smoke'
  pkg.build.directories.output = `release/update-smoke/${version}`
  pkg.build.extraMetadata = {
    ...(pkg.build.extraMetadata || {}),
    version,
    verxioUpdateSmoke: true
  }
  delete pkg.build.extraResources
  pkg.build.mac.target = [target]
  pkg.build.mac.identity = identityName
  // A local cert cannot get an Apple timestamp. Asking for one signs every
  // nested file through the network and the smoke build never finishes.
  pkg.build.mac.timestamp = 'none'
  pkg.build.mac.extendInfo = {
    ...(pkg.build.mac.extendInfo || {}),
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true
    }
  }
  pkg.build.publish = [{ provider: 'generic', url: feedUrl }]
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function buildApp(version, feedUrl, target, signEnv) {
  writePackageFor(version, feedUrl, target)
  await run('npx', ['electron-builder', '--mac', target, `--${arch}`, '--publish', 'never'], { env: signEnv })
  restorePackageJson()

  const output = path.join(smokeRoot, version)
  const apps = findByExtension(output, '.app')

  if (apps.length !== 1) {
    throw new Error(`Expected one app in ${output}, found ${apps.join(', ') || 'none'}`)
  }

  return { output, appPath: apps[0] }
}

function assertUpdaterPacked(appPath) {
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar')
  const asar = require('@electron/asar')
  const files = asar.listPackage(asarPath, {})
  const packed = files.some(file => file.replaceAll('\\', '/').includes('node_modules/electron-updater/package.json'))

  if (!packed) {
    throw new Error('electron-updater was not packed into app.asar')
  }
}

function startFeed(root) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const relative = decodeURIComponent(url.pathname.replace(/^\/updates\/?/, ''))
    const filePath = path.resolve(root, relative)
    const inside = filePath === root || filePath.startsWith(`${root}${path.sep}`)

    console.log(`[update-smoke] ${request.method} ${url.pathname}`)

    if (!inside || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404)
      response.end()

      return
    }

    const stat = fs.statSync(filePath)
    const type = filePath.endsWith('.yml') ? 'text/yaml' : 'application/zip'
    const range = request.headers.range

    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range)
      if (!match) {
        response.writeHead(416)
        response.end()

        return
      }

      const start = Number(match[1])
      const end = match[2] ? Number(match[2]) : stat.size - 1
      response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Type': type
      })

      if (request.method === 'HEAD') {
        response.end()

        return
      }

      fs.createReadStream(filePath, { start, end }).pipe(response)

      return
    }

    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
      'Content-Type': type
    })

    if (request.method === 'HEAD') {
      response.end()

      return
    }

    fs.createReadStream(filePath).pipe(response)
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      feedServer = server
      resolve(port)
    })
  })
}

function dumpFailure(userData, appLog) {
  console.error('\n[update-smoke] failure logs')

  if (fs.existsSync(appLog)) {
    const text = fs.readFileSync(appLog, 'utf8')
    console.error(`----- ${appLog} -----\n${text.slice(-8000)}`)
  }

  const logsDir = path.join(userData, 'logs')

  if (fs.existsSync(logsDir)) {
    for (const entry of fs.readdirSync(logsDir)) {
      const file = path.join(logsDir, entry)
      if (!fs.statSync(file).isFile()) continue
      const text = fs.readFileSync(file, 'utf8')
      console.error(`----- ${file} -----\n${text.slice(-8000)}`)
    }
  }
}

async function waitFor(label, timeoutMs, read) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const value = await read()

    if (value) {
      return value
    }

    await delay(500)
  }

  throw new Error(`Timed out waiting for ${label}`)
}

async function connectCdp(port) {
  const page = await waitFor('the app window', 90_000, async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)

      if (!response.ok) {
        return null
      }

      const list = await response.json()

      return list.find(item => item.type === 'page' && item.webSocketDebuggerUrl) || null
    } catch {
      return null
    }
  })
  const socket = new WebSocket(page.webSocketDebuggerUrl)

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const consoleLines = []

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)

    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)

      if (message.error) {
        waiter.reject(new Error(message.error.message || 'CDP error'))
      } else {
        waiter.resolve(message.result)
      }

      return
    }

    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params?.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ')
      consoleLines.push(text)
    }

    if (message.method === 'Runtime.exceptionThrown') {
      consoleLines.push(message.params?.exceptionDetails?.text || 'renderer exception')
    }
  })

  function send(method, params = {}) {
    const id = ++nextId

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  await send('Runtime.enable')
  await send('Console.enable').catch(() => undefined)

  return { send, consoleLines, close: () => socket.close() }
}

async function pageSummary(send) {
  const result = await Promise.race([
    send('Runtime.evaluate', {
      expression: `JSON.stringify({
        hasUpdates: Boolean(window.hermesDesktop && window.hermesDesktop.updates),
        text: (document.body && document.body.innerText || '').slice(0, 1500)
      })`,
      returnByValue: true
    }),
    delay(5_000).then(() => null)
  ])

  return result?.result?.value || ''
}

async function clickUpdate(send) {
  const result = await send('Runtime.evaluate', {
    expression: `(() => {
      const button = [...document.querySelectorAll('button')].find(element => (element.textContent || '').trim() === 'Update now')
      if (!button) return false
      button.click()
      return true
    })()`,
    returnByValue: true
  })

  return result.result?.value === true
}

async function main() {
  fs.rmSync(smokeRoot, { recursive: true, force: true })
  fs.rmSync(launchedRoot, { recursive: true, force: true })
  fs.mkdirSync(smokeRoot, { recursive: true })

  const { p12Path } = createSigningIdentity()
  const signEnv = {
    CSC_IDENTITY_AUTO_DISCOVERY: 'true',
    CSC_KEY_PASSWORD: keychainPassword,
    CSC_LINK: p12Path,
    CSC_NAME: identityName
  }

  console.log('[update-smoke] building renderer')
  await buildRenderer()

  const feedRoot = path.join(smokeRoot, '0.0.2')
  fs.mkdirSync(feedRoot, { recursive: true })
  const feedPort = await startFeed(feedRoot)
  const feedUrl = `http://127.0.0.1:${feedPort}/updates`
  console.log(`[update-smoke] feed ${feedUrl}`)

  console.log('[update-smoke] packaging 0.0.1')
  const oldBuild = await buildApp('0.0.1', feedUrl, 'zip', signEnv)
  ensureSigned(oldBuild.appPath)
  assertUpdaterPacked(oldBuild.appPath)
  const updateManifest = path.join(oldBuild.appPath, 'Contents', 'Resources', 'app-update.yml')

  if (!fs.existsSync(updateManifest)) {
    throw new Error(`The packaged app is missing ${updateManifest}`)
  }

  console.log('[update-smoke] packaging 0.0.2')
  const newBuild = await buildApp('0.0.2', feedUrl, 'zip', signEnv)
  const resigned = ensureSigned(newBuild.appPath)
  let zips = findByExtension(newBuild.output, '.zip')

  if (resigned || zips.length !== 1) {
    const zipPath = path.join(newBuild.output, `Verxio-0.0.2-mac-${arch}.zip`)
    zipApp(newBuild.appPath, zipPath)
    zips = [zipPath]
  }

  const ymlFiles = findByExtension(newBuild.output, '.yml').filter(file => path.basename(file) === 'latest-mac.yml')
  const ymlReady = !resigned && ymlFiles.some(file => fs.readFileSync(file, 'utf8').includes('version: 0.0.2'))

  if (!ymlReady) {
    await writeLatestMacYml(zips[0])
  }

  const installedDir = launchedRoot
  const installedApp = launchedApp
  fs.mkdirSync(installedDir, { recursive: true })
  mustStatus(spawnSync('ditto', [oldBuild.appPath, installedApp], { encoding: 'utf8' }), 'ditto install')
  mustStatus(
    spawnSync('codesign', ['--verify', '--verbose=2', installedApp], { encoding: 'utf8' }),
    'verify installed app'
  )

  const userData = path.join(smokeRoot, 'user-data')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(installedDir, 'verxio-update-smoke.json'),
    `${JSON.stringify(
      {
        feed: feedUrl,
        purpose: 'verxio-update-smoke',
        userData
      },
      null,
      2
    )}\n`
  )

  const binary = path.join(installedApp, 'Contents', 'MacOS', 'Verxio')
  const versionFile = path.join(userData, 'running-version.txt')
  const appLog = path.join(smokeRoot, 'app.log')
  const debugPort = await freePort()
  const logFd = fs.openSync(appLog, 'a')
  const env = { ...process.env, ...signEnv }

  delete env.ELECTRON_RUN_AS_NODE
  delete env.VERXIO_DESKTOP_DEV_SERVER
  env.VERXIO_UPDATE_FEED = feedUrl
  env.VERXIO_DESKTOP_USER_DATA_DIR = userData
  env.ELECTRON_LOG_LEVEL = 'debug'

  console.log('[update-smoke] launching 0.0.1')
  appProcess = spawn(binary, [`--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*'], {
    env,
    stdio: ['ignore', logFd, logFd]
  })

  let cdp = null

  try {
    await waitFor('0.0.1 to report its version', 90_000, async () => {
      if (!fs.existsSync(versionFile)) {
        return false
      }

      return fs.readFileSync(versionFile, 'utf8').trim() === '0.0.1'
    })

    cdp = await connectCdp(debugPort)
    const oldPid = appProcess.pid

    await waitFor('the Update now button', 90_000, async () => {
      try {
        return await clickUpdate(cdp.send)
      } catch {
        return false
      }
    })
    console.log('[update-smoke] clicked Update now')

    await waitFor('the relaunched 0.0.2 app', 360_000, async () => {
      let version = ''

      try {
        version = fs.readFileSync(versionFile, 'utf8').trim()
      } catch {
        return false
      }

      if (version !== '0.0.2') {
        return false
      }

      const stillOld = pidsFor(binary).includes(oldPid)
      const running = pidsFor(binary).length > 0

      return !stillOld && running
    })

    console.log('[update-smoke] relaunched Verxio 0.0.2')
  } catch (error) {
    dumpFailure(userData, appLog)

    if (cdp) {
      try {
        console.error(await pageSummary(cdp.send))
        console.error(cdp.consoleLines.slice(-30).join('\n'))
      } catch {
        // The window may already be gone.
      }
    }

    throw error
  } finally {
    cdp?.close()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
} finally {
  cleanup()
}
