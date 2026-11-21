function unsupported(message) {
  return {
    supported: false,
    reason: message,
    message
  }
}

function isNewerRelease(current, next) {
  const semver = require('semver')
  const left = semver.valid(semver.coerce(String(current || '')))
  const right = semver.valid(semver.coerce(String(next || '')))

  if (!left || !right) {
    return false
  }

  return semver.gt(right, left)
}

function statusForFeed(currentVersion, feedVersion) {
  const next = typeof feedVersion === 'string' ? feedVersion.trim() : ''

  if (!next || !isNewerRelease(currentVersion, next)) {
    return {
      supported: true,
      behind: 0,
      message: next ? 'Verxio Desktop is up to date' : 'No update available'
    }
  }

  return {
    supported: true,
    behind: 1,
    targetSha: next,
    message: `Update ${next} is available`
  }
}

function shouldCheckForUpdates({ isPackaged, feedUrl }) {
  return Boolean(String(feedUrl || '').trim()) || Boolean(isPackaged)
}

function createUpdater(options = {}) {
  const send = typeof options.onProgress === 'function' ? options.onProgress : () => undefined
  const feedUrl =
    options.feedUrl !== undefined
      ? String(options.feedUrl || '').trim()
      : String(process.env.VERXIO_UPDATE_FEED || '').trim()
  let autoUpdater = null
  let loadError = null
  let configured = false

  function emit(payload) {
    send({ error: null, at: Date.now(), ...payload })
  }

  function resolvePackaged() {
    if (typeof options.isPackaged === 'boolean') {
      return options.isPackaged
    }

    try {
      return Boolean(require('electron').app.isPackaged)
    } catch {
      return false
    }
  }

  function resolveCurrentVersion() {
    if (options.currentVersion) {
      return String(options.currentVersion)
    }

    try {
      return require('electron').app.getVersion()
    } catch {
      return '0.0.0'
    }
  }

  function loadAutoUpdater() {
    if (autoUpdater || loadError) {
      return autoUpdater
    }

    try {
      ;({ autoUpdater } = require('electron-updater'))
    } catch (error) {
      loadError = error

      return null
    }

    if (!configured) {
      configured = true
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true

      if (feedUrl) {
        autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
        autoUpdater.forceDevUpdateConfig = true
      }

      autoUpdater.on('checking-for-update', () =>
        emit({ stage: 'prepare', message: 'Checking for updates…', percent: 10 })
      )
      autoUpdater.on('update-available', info =>
        emit({ stage: 'fetch', message: `Update ${info.version} is available`, percent: 30 })
      )
      autoUpdater.on('update-not-available', () =>
        emit({ stage: 'idle', message: 'Verxio Desktop is up to date', percent: 100 })
      )
      autoUpdater.on('download-progress', progress =>
        emit({
          stage: 'fetch',
          message: 'Downloading update…',
          percent: Math.round(progress.percent || 0)
        })
      )
      autoUpdater.on('update-downloaded', () =>
        emit({ stage: 'restart', message: 'Update downloaded. Restart to apply.', percent: 100 })
      )
      autoUpdater.on('error', error =>
        emit({ stage: 'error', message: error instanceof Error ? error.message : String(error), percent: null })
      )
    }

    return autoUpdater
  }

  return {
    check: async () => {
      if (!shouldCheckForUpdates({ isPackaged: resolvePackaged(), feedUrl })) {
        return {
          supported: true,
          behind: 0,
          message: 'Update checks run in packaged builds.'
        }
      }

      const updater = loadAutoUpdater()

      if (!updater) {
        return unsupported(
          'electron-updater is not installed. Packaged Mac builds need Developer ID signing to auto-update.'
        )
      }

      try {
        const result = await updater.checkForUpdates()

        return statusForFeed(resolveCurrentVersion(), result?.updateInfo?.version)
      } catch (error) {
        return unsupported(error instanceof Error ? error.message : String(error))
      }
    },
    apply: async () => {
      const updater = loadAutoUpdater()

      if (!updater) {
        return {
          ok: false,
          manual: true,
          command: 'Download the latest release from GitHub.',
          message: 'Auto-update is not available in this build.'
        }
      }

      try {
        await updater.downloadUpdate()
        // isForceRunAfter reopens the app after the installer finishes.
        updater.quitAndInstall(false, true)

        return { ok: true, message: 'Restarting to apply the update.' }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          message: 'Could not apply the update.'
        }
      }
    }
  }
}

module.exports = { createUpdater, isNewerRelease, shouldCheckForUpdates, statusForFeed }
