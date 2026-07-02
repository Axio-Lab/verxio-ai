import * as QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { applyWhatsAppPairing, cancelWhatsAppPairing, getWhatsAppPairingStatus, startWhatsAppPairing } from '@/hermes'
import { useI18n } from '@/i18n'
import { MessageCircle, RefreshCw } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import { runGatewayRestart } from '@/store/system-actions'
import type { MessagingPlatformInfo } from '@/types/hermes'

import { ListRow } from '../settings/primitives'

interface WhatsAppPairingPanelProps {
  onChanged: () => Promise<void>
  platform: MessagingPlatformInfo
}

export function WhatsAppPairingPanel({ onChanged, platform }: WhatsAppPairingPanelProps) {
  const { t } = useI18n()
  const m = t.messaging.whatsappPairing
  const [pairingId, setPairingId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('idle')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [allowedUsers, setAllowedUsers] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pairingIdRef = useRef<string | null>(null)

  pairingIdRef.current = pairingId

  const reset = useCallback(() => {
    setPairingId(null)
    setStatus('idle')
    setQrDataUrl('')
    setError('')
  }, [])

  const renderQr = useCallback(async (payload: string | null | undefined) => {
    if (!payload) {
      setQrDataUrl('')

      return
    }

    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240
    })

    setQrDataUrl(dataUrl)
  }, [])

  const start = useCallback(
    async (forceReset = false) => {
      setBusy(true)
      setError('')

      try {
        const res = await startWhatsAppPairing({ reset: forceReset })

        if (res.paired || res.status === 'already_paired') {
          setStatus('connected')
          await onChanged()

          return
        }

        if (!res.pairing_id) {
          throw new Error(m.startFailed)
        }

        setPairingId(res.pairing_id)
        setStatus(res.status || 'starting')
        await renderQr(res.qr)
      } catch (err) {
        reset()
        notifyError(err, m.startFailed)
      } finally {
        setBusy(false)
      }
    },
    [m.startFailed, onChanged, renderQr, reset]
  )

  useEffect(() => {
    if (!pairingId || status === 'connected' || status === 'idle') {
      return
    }

    let cancelled = false
    let timeout: number | undefined

    const poll = async () => {
      if (cancelled) {
        return
      }

      try {
        const res = await getWhatsAppPairingStatus(pairingId)

        if (cancelled) {
          return
        }

        setStatus(res.status)
        await renderQr(res.qr)

        if (res.paired || res.status === 'connected') {
          setStatus('connected')
          notify({ kind: 'success', title: m.pairedTitle, message: m.pairedMessage })
          await onChanged()

          return
        }

        timeout = window.setTimeout(poll, 2000)
      } catch (err) {
        if (cancelled) {
          return
        }

        setError(err instanceof Error ? err.message : String(err))
        reset()
      }
    }

    timeout = window.setTimeout(poll, 1200)

    return () => {
      cancelled = true

      if (timeout) {
        window.clearTimeout(timeout)
      }
    }
  }, [m.pairedMessage, m.pairedTitle, onChanged, pairingId, renderQr, reset, status])

  useEffect(
    () => () => {
      const id = pairingIdRef.current

      if (id) {
        void cancelWhatsAppPairing(id)
      }
    },
    []
  )

  async function handleApply() {
    if (!pairingId) {
      setError(m.scanFirst)

      return
    }

    if (status !== 'connected') {
      setError(m.scanFirst)

      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await applyWhatsAppPairing(pairingId, {
        allowed_users: allowedUsers.trim() || undefined
      })

      if (result.restart_started) {
        notify({ kind: 'success', title: m.connectedTitle, message: m.restartingGateway })
        await runGatewayRestart()
      } else {
        notify({
          kind: 'success',
          title: m.connectedTitle,
          message: m.restartManually,
          action: { label: t.commandCenter.restartGateway, onClick: () => void runGatewayRestart() }
        })
      }

      reset()
      await onChanged()
    } catch (err) {
      notifyError(err, m.applyFailed)
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (pairingId) {
      try {
        await cancelWhatsAppPairing(pairingId)
      } catch {
        /* local reset still wins */
      }
    }

    reset()
  }

  if (platform.configured && status !== 'connected') {
    return (
      <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{m.title}</h4>
        <p className="mt-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {m.alreadyPaired}
        </p>
        <div className="mt-3">
          <Button disabled={busy} onClick={() => void start(true)} size="sm" variant="outline">
            <RefreshCw className="size-3.5" />
            {m.repair}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{m.title}</h4>
      <p className="mt-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {m.description}
      </p>

      {status === 'idle' && (
        <div className="mt-4">
          <Button disabled={busy} onClick={() => void start()} size="sm">
            <MessageCircle className="size-3.5" />
            {busy ? m.starting : m.showQr}
          </Button>
        </div>
      )}

      {(status === 'starting' || status === 'waiting_qr' || status === 'disconnected') && (
        <div className="mt-4 flex flex-col items-start gap-3">
          {!qrDataUrl ? (
            <PageLoader label={m.waitingForQr} />
          ) : (
            <img alt={m.qrAlt} className="rounded-lg border border-border bg-white p-3" src={qrDataUrl} />
          )}
          <p className="text-xs leading-5 text-muted-foreground">{m.scanInstructions}</p>
          <Button disabled={busy} onClick={() => void handleCancel()} size="sm" variant="ghost">
            {m.cancel}
          </Button>
        </div>
      )}

      {status === 'connected' && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-primary">{m.pairedMessage}</p>
          <ListRow
            action={
              <Input
                onChange={event => setAllowedUsers(event.target.value)}
                placeholder={m.allowedUsersPlaceholder}
                value={allowedUsers}
              />
            }
            description={m.allowedUsersHelp}
            title={m.allowedUsersLabel}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void handleApply()} size="sm">
              {busy ? m.connecting : m.finishSetup}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </section>
  )
}
