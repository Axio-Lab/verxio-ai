import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Loader2, RefreshCw } from '@/lib/icons'
import { getVerxioRuntime, verxioApiEnabled } from '@/lib/verxio-api'
import {
  $runtimeRestarting,
  runAgentRuntimeRestart,
  runGatewayRestart,
  runRuntimeEnvReload,
  runVerxioContainerRestart
} from '@/store/system-actions'

import { ListRow, SectionHeading, SettingsContent } from './primitives'

export function RuntimeSettings() {
  const { t } = useI18n()
  const copy = t.settings.runtime
  const hosted = verxioApiEnabled()
  const restarting = useStore($runtimeRestarting)
  const [loadingStatus, setLoadingStatus] = useState(hosted)
  const [runtimeStatus, setRuntimeStatus] = useState<'connected' | 'error' | 'starting' | 'stopped' | 'unknown'>(
    'unknown'
  )
  const [reloadBusy, setReloadBusy] = useState(false)

  const refreshStatus = useCallback(async () => {
    if (!hosted) {
      setLoadingStatus(false)

      return
    }

    setLoadingStatus(true)

    try {
      const status = await getVerxioRuntime()
      const next = status.runtime.status

      if (status.connected) {
        setRuntimeStatus('connected')
      } else if (next === 'starting') {
        setRuntimeStatus('starting')
      } else if (next === 'stopped') {
        setRuntimeStatus('stopped')
      } else {
        setRuntimeStatus('error')
      }
    } catch {
      setRuntimeStatus('error')
    } finally {
      setLoadingStatus(false)
    }
  }, [hosted])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const statusLabel =
    runtimeStatus === 'connected'
      ? copy.statusConnected
      : runtimeStatus === 'starting'
        ? copy.statusStarting
        : runtimeStatus === 'stopped'
          ? copy.statusStopped
          : runtimeStatus === 'error'
            ? copy.statusError
            : copy.statusUnknown

  const handleReload = async () => {
    setReloadBusy(true)

    try {
      await runRuntimeEnvReload()
    } finally {
      setReloadBusy(false)
    }
  }

  const handleAgentRestart = async () => {
    const ok = await runAgentRuntimeRestart()

    if (ok) {
      await refreshStatus()
    }
  }

  const handleContainerRestart = async () => {
    const ok = await runVerxioContainerRestart()

    if (ok) {
      await refreshStatus()
    }
  }

  return (
    <SettingsContent>
      <SectionHeading icon={RefreshCw} title={copy.title} />
      <p className="mb-4 text-xs text-muted-foreground">{copy.intro}</p>

      {hosted ? (
        <ListRow
          action={
            <Button
              disabled={loadingStatus}
              onClick={() => void refreshStatus()}
              size="sm"
              type="button"
              variant="ghost"
            >
              {loadingStatus ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            </Button>
          }
          description={copy.statusDescription}
          hint={statusLabel}
          title={copy.statusTitle}
        />
      ) : null}

      <div className="mt-4 grid gap-3">
        <ListRow
          action={
            <Button disabled={reloadBusy || restarting} onClick={() => void handleReload()} size="sm" type="button">
              {reloadBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {copy.reloadAction}
            </Button>
          }
          description={copy.reloadDescription}
          title={copy.reloadTitle}
        />

        <ListRow
          action={
            <Button
              disabled={restarting || reloadBusy}
              onClick={() => void handleAgentRestart()}
              size="sm"
              type="button"
              variant="outline"
            >
              {restarting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {copy.agentRestartAction}
            </Button>
          }
          description={copy.agentRestartDescription}
          title={copy.agentRestartTitle}
        />

        {hosted ? (
          <ListRow
            action={
              <Button
                disabled={restarting || reloadBusy}
                onClick={() => void handleContainerRestart()}
                size="sm"
                type="button"
                variant="outline"
              >
                {restarting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {copy.containerRestartAction}
              </Button>
            }
            description={copy.containerRestartDescription}
            title={copy.containerRestartTitle}
          />
        ) : null}

        <ListRow
          action={
            <Button
              disabled={restarting}
              onClick={() => void runGatewayRestart()}
              size="sm"
              type="button"
              variant="ghost"
            >
              {copy.gatewayRestartAction}
            </Button>
          }
          description={copy.gatewayRestartDescription}
          title={copy.gatewayRestartTitle}
        />
      </div>
    </SettingsContent>
  )
}
