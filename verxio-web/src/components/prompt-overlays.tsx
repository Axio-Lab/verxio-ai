'use client'

import { useStore } from '@nanostores/react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { fishAudioConfirmationParams } from '@/lib/fishaudio-session'
import { triggerHaptic } from '@/lib/haptics'
import { AlertTriangle, KeyRound, Loader2, Lock } from '@/lib/icons'
import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import {
  $fishAudioConfirmationRequest,
  $secretRequest,
  $sudoRequest,
  clearFishAudioConfirmationRequest,
  clearSecretRequest,
  clearSudoRequest
} from '@/store/prompts'

// Renders the modal mid-turn prompts the gateway raises and waits on: sudo
// password and skill secret capture. (Dangerous-command / execute_code approval
// is rendered INLINE on the pending tool row instead — see
// components/assistant-ui/tool-approval.tsx — so it reads like an inline "Run"
// affordance rather than a blocking modal.) Each Python-side caller blocks the
// agent thread until the matching `*.respond` RPC lands; without a renderer the
// agent stalls until its timeout and the tool is BLOCKED (the bug this fixes —
// desktop handled clarify.request but not these). Any close path (Esc, backdrop
// click) funnels through Radix's single `onOpenChange(false)` and maps to a
// refusal, so silence is never mistaken for consent, matching the TUI. We
// deliberately do NOT add onEscapeKeyDown / onInteractOutside handlers — they'd
// fire a second `*.respond` alongside onOpenChange (double-send) or block the
// backdrop-dismiss path.

function SudoDialog() {
  const { t } = useI18n()
  const copy = t.prompts
  const request = useStore($sudoRequest)
  const gateway = useStore($gateway)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setPassword('')
    setSubmitting(false)
  }, [request?.requestId])

  const send = useCallback(
    async (value: string) => {
      if (!request) {
        return
      }

      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.sudoSendFailed)

        return
      }

      setSubmitting(true)

      try {
        await gateway.request<{ status?: string }>('sudo.respond', {
          password: value,
          request_id: request.requestId
        })
        triggerHaptic('submit')
        clearSudoRequest(request.sessionId, request.requestId)
      } catch (error) {
        notifyError(error, copy.sudoSendFailed)
        setSubmitting(false)
      }
    },
    [copy.gatewayDisconnected, copy.sudoSendFailed, gateway, request]
  )

  // Cancel → empty password. The backend treats an empty sudo response as a
  // failed sudo (no command runs), so closing the dialog is a safe refusal.
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !submitting && request) {
        void send('')
      }
    },
    [request, send, submitting]
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void send(password)
    },
    [password, send]
  )

  if (!request) {
    return null
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle icon={Lock}>{copy.sudoTitle}</DialogTitle>
          <DialogDescription>{copy.sudoDesc}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={onSubmit}>
          <Input
            autoFocus
            disabled={submitting}
            onChange={event => setPassword(event.target.value)}
            placeholder={copy.sudoPlaceholder}
            type="password"
            value={password}
          />
          <DialogFooter>
            <Button disabled={submitting} onClick={() => void send('')} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={submitting} type="submit">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : t.common.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SecretDialog() {
  const { t } = useI18n()
  const copy = t.prompts
  const request = useStore($secretRequest)
  const gateway = useStore($gateway)
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setValue('')
    setSubmitting(false)
  }, [request?.requestId])

  const send = useCallback(
    async (secret: string) => {
      if (!request) {
        return
      }

      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.secretSendFailed)

        return
      }

      setSubmitting(true)

      try {
        await gateway.request<{ status?: string }>('secret.respond', {
          request_id: request.requestId,
          value: secret
        })
        triggerHaptic('submit')
        clearSecretRequest(request.sessionId, request.requestId)
      } catch (error) {
        notifyError(error, copy.secretSendFailed)
        setSubmitting(false)
      }
    },
    [copy.gatewayDisconnected, copy.secretSendFailed, gateway, request]
  )

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !submitting && request) {
        void send('')
      }
    },
    [request, send, submitting]
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void send(value)
    },
    [send, value]
  )

  if (!request) {
    return null
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle icon={KeyRound}>{request.envVar || copy.secretTitle}</DialogTitle>
          <DialogDescription>{request.prompt || copy.secretDesc}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={onSubmit}>
          <Input
            autoFocus
            disabled={submitting}
            onChange={event => setValue(event.target.value)}
            placeholder={request.envVar || copy.secretPlaceholder}
            type="password"
            value={value}
          />
          <DialogFooter>
            <Button disabled={submitting} onClick={() => void send('')} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={submitting || !value} type="submit">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : t.common.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function FishAudioConfirmationDialog() {
  const { t } = useI18n()
  const copy = t.prompts
  const request = useStore($fishAudioConfirmationRequest)
  const gateway = useStore($gateway)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSubmitting(false)
    setError(request?.error ?? null)
  }, [request?.error, request?.requestId])

  const respond = useCallback(
    async (approved: boolean) => {
      if (!request || submitting) {
        return
      }

      if (!approved) {
        if (gateway && typeof request.confirmation !== 'string') {
          setSubmitting(true)
          try {
            await gateway.request(
              'fishaudio.confirmation.respond',
              fishAudioConfirmationParams({
                approved: false,
                confirmation: request.confirmation,
                requestId: request.requestId,
                sessionId: request.sessionId
              })
            )
          } catch {
            // A failed refusal still fails closed when the backend prompt expires.
          }
        }

        triggerHaptic('selection')
        clearFishAudioConfirmationRequest(request.sessionId, request.requestId)
        return
      }

      if (!gateway) {
        setError(copy.gatewayDisconnected)

        return
      }

      setSubmitting(true)
      setError(null)

      try {
        if (typeof request.confirmation === 'string') {
          await gateway.request('prompt.submit', {
            session_id: request.sessionId ?? undefined,
            text: request.confirmation
          })
        } else {
          await gateway.request(
            'fishaudio.confirmation.respond',
            fishAudioConfirmationParams({
              approved: true,
              confirmation: request.confirmation,
              requestId: request.requestId,
              sessionId: request.sessionId
            })
          )
        }

        triggerHaptic('submit')
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : copy.fishAudioConfirmationFailed)
        setSubmitting(false)
      }
    },
    [copy.fishAudioConfirmationFailed, copy.gatewayDisconnected, gateway, request, submitting]
  )

  if (!request) {
    return null
  }

  const expiry = new Date(request.expiresAt)

  const expiryLabel = Number.isNaN(expiry.getTime())
    ? request.expiresAt
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(expiry)

  return (
    <Dialog onOpenChange={open => !open && !submitting && void respond(false)} open>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{copy.fishAudioTitle}</DialogTitle>
          <DialogDescription>{request.description || copy.fishAudioDescription}</DialogDescription>
        </DialogHeader>

        <dl className="grid gap-2 rounded-md border border-(--stroke-nous) bg-muted/20 px-3 py-2 text-sm">
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{copy.fishAudioAction}</dt>
            <dd className="font-medium text-foreground">{request.actionLabel}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{copy.fishAudioExpires}</dt>
            <dd className="text-foreground">{expiryLabel}</dd>
          </div>
        </dl>

        {submitting ? (
          <div aria-label={copy.fishAudioWorking} className="flex min-h-24 items-center justify-center" role="status">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <DialogFooter>
          <Button disabled={submitting} onClick={() => void respond(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button
            disabled={submitting}
            onClick={() => void respond(true)}
            variant={request.action === 'delete' ? 'destructive' : 'default'}
          >
            {request.action === 'delete' ? t.common.delete : t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PromptOverlays() {
  return (
    <>
      <FishAudioConfirmationDialog />
      <SudoDialog />
      <SecretDialog />
    </>
  )
}
