function unsupported(message) {
  return {
    supported: false,
    reason: message,
    message
  }
}

function createUpdater(options = {}) {
  const send = typeof options.onProgress === 'function' ? options.onProgress : () => undefined
  let autoUpdater = null
  try {
    ;({ autoUpdater } = require('electron-updater'))
  } catch {
    return {
      check: async () =>
        unsupported('electron-updater is not installed. Packaged Mac builds need Developer ID signing to auto-update.'),
      apply: async () => ({
        ok: false,
        manual: true,
        command: 'Download the latest release from GitHub.',
        message: 'Auto-update is not available in this build.'
      })
    }
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => send({ stage: 'prepare', message: 'Checking for updates…', percent: 10 }))
  autoUpdater.on('update-available', info =>
    send({ stage: 'fetch', message: `Update ${info.version} is available`, percent: 30 })
  )
  autoUpdater.on('update-not-available', () =>
    send({ stage: 'idle', message: 'Verxio Desktop is up to date', percent: 100 })
  )
  autoUpdater.on('download-progress', progress =>
    send({
      stage: 'fetch',
      message: 'Downloading update…',
      percent: Math.round(progress.percent || 0)
    })
  )
  autoUpdater.on('update-downloaded', () =>
    send({ stage: 'restart', message: 'Update downloaded. Restart to apply.', percent: 100 })
  )
  autoUpdater.on('error', error =>
    send({ stage: 'error', message: error instanceof Error ? error.message : String(error), percent: null })
  )

  return {
    check: async () => {
      try {
        const result = await autoUpdater.checkForUpdates()
        const version = result?.updateInfo?.version
        return {
          supported: true,
          behind: version ? 1 : 0,
          message: version ? `Update ${version} is available` : 'No update available'
        }
      } catch (error) {
        return unsupported(error instanceof Error ? error.message : String(error))
      }
    },
    apply: async () => {
      try {
        await autoUpdater.downloadUpdate()
        autoUpdater.quitAndInstall()
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

module.exports = { createUpdater }
