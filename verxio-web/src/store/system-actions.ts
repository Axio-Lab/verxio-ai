import { atom } from 'nanostores'

import { getActionStatus, reloadRuntimeEnv, restartAgentRuntime, restartGateway } from '@/hermes'
import { translateNow } from '@/i18n'
import { getVerxioRuntime, restartVerxioRuntime, verxioApiEnabled } from '@/lib/verxio-api'
import { notify, notifyError } from '@/store/notifications'
import type { ActionResponse } from '@/types/hermes'

const POLL_ATTEMPTS = 18
const POLL_INTERVAL_MS = 1200
const POLL_TIMEOUT_S = 180
const RUNTIME_POLL_ATTEMPTS = 45
const RUNTIME_POLL_INTERVAL_MS = 1000

export const $gatewayRestarting = atom(false)
export const $runtimeRestarting = atom(false)

async function awaitAction(started: ActionResponse): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS))
    const status = await getActionStatus(started.name, POLL_TIMEOUT_S)

    if (!status.running) {
      if (status.exit_code != null && status.exit_code !== 0) {
        throw new Error(translateNow('commandCenter.gatewayRestartFailed'))
      }

      return
    }
  }
}

async function waitForVerxioRuntimeReady(): Promise<void> {
  for (let attempt = 0; attempt < RUNTIME_POLL_ATTEMPTS; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, RUNTIME_POLL_INTERVAL_MS))

    try {
      const status = await getVerxioRuntime()

      if (status.connected) {
        return
      }
    } catch {
      // Container still booting.
    }
  }

  throw new Error(translateNow('settings.runtime.restartTimeout'))
}

export async function runGatewayRestart(): Promise<void> {
  $gatewayRestarting.set(true)

  try {
    await awaitAction(await restartGateway())
  } catch (err) {
    notifyError(err, translateNow('commandCenter.gatewayRestartFailed'))
  } finally {
    $gatewayRestarting.set(false)
  }
}

export async function runRuntimeEnvReload(options: { notifySuccess?: boolean } = {}): Promise<boolean> {
  try {
    await reloadRuntimeEnv()

    if (options.notifySuccess !== false) {
      notify({
        kind: 'success',
        title: translateNow('settings.runtime.reloadDoneTitle'),
        message: translateNow('settings.runtime.reloadDoneMessage'),
        durationMs: 5000
      })
    }

    return true
  } catch (err) {
    notifyError(err, translateNow('settings.runtime.reloadFailed'))

    return false
  }
}

/** Reload .env and restart the Hermes gateway process (in-container soft restart). */
export async function runAgentRuntimeRestart(): Promise<boolean> {
  $runtimeRestarting.set(true)

  try {
    const started = await restartAgentRuntime()
    await awaitAction(started)
    notify({
      kind: 'success',
      title: translateNow('settings.runtime.agentRestartDoneTitle'),
      message: started.message ?? translateNow('settings.runtime.agentRestartDoneMessage'),
      durationMs: 6000
    })

    return true
  } catch (err) {
    notifyError(err, translateNow('settings.runtime.agentRestartFailed'))

    return false
  } finally {
    $runtimeRestarting.set(false)
  }
}

/** Restart the isolated Verxio Docker runtime container (hosted mode). */
export async function runVerxioContainerRestart(): Promise<boolean> {
  if (!verxioApiEnabled()) {
    return runAgentRuntimeRestart()
  }

  $runtimeRestarting.set(true)

  try {
    await restartVerxioRuntime()
    await waitForVerxioRuntimeReady()
    notify({
      kind: 'success',
      title: translateNow('settings.runtime.containerRestartDoneTitle'),
      message: translateNow('settings.runtime.containerRestartDoneMessage'),
      durationMs: 6000
    })

    return true
  } catch (err) {
    notifyError(err, translateNow('settings.runtime.containerRestartFailed'))

    return false
  } finally {
    $runtimeRestarting.set(false)
  }
}
