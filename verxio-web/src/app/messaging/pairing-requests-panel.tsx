import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { approvePairing, getPairing, revokePairing } from '@/hermes'
import { useI18n } from '@/i18n'
import { Check, RefreshCw, Trash2, Users } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import type { MessagingPlatformInfo, PairingUser } from '@/types/hermes'

interface PairingRequestsPanelProps {
  platform: MessagingPlatformInfo
}

function pairingUserLabel(user: PairingUser): string {
  return user.user_name || user.user_id || 'Unknown user'
}

function approvedTime(user: PairingUser): string {
  return user.approved_at ? new Date(user.approved_at * 1000).toLocaleString() : ''
}

export function PairingRequestsPanel({ platform }: PairingRequestsPanelProps) {
  const { t } = useI18n()
  const copy = t.messaging.pairingRequests
  const platformId = platform.id.toLowerCase()
  const [pending, setPending] = useState<PairingUser[]>([])
  const [approved, setApproved] = useState<PairingUser[]>([])
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState<null | string>(null)
  const codeId = `pairing-code-${platformId}`
  const errorId = `${codeId}-error`
  const pendingTitle = useMemo(() => copy.pendingTitle(pending.length), [copy, pending.length])
  const approvedTitle = useMemo(() => copy.approvedTitle(approved.length), [approved.length, copy])

  const loadPairing = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setLoading(true)
      }

      try {
        const result = await getPairing()
        setPending((result.pending ?? []).filter(user => user.platform.toLowerCase() === platformId))
        setApproved((result.approved ?? []).filter(user => user.platform.toLowerCase() === platformId))
        setLoadError(false)
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    },
    [platformId]
  )

  useEffect(() => {
    void loadPairing(true)
  }, [loadPairing])

  async function handleApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmed = code.trim().toUpperCase()

    if (!trimmed) {
      setFormError(copy.codeRequired)

      return
    }

    setBusy('approve')
    setFormError('')

    try {
      const result = await approvePairing(platformId, trimmed)
      setCode('')
      notify({
        kind: 'success',
        title: copy.approvedToastTitle,
        message: copy.approvedToastMessage(pairingUserLabel(result.user), platform.name)
      })
      await loadPairing(false)
    } catch (err) {
      setFormError(copy.approveFailed)
      notifyError(err, copy.approveFailed)
    } finally {
      setBusy(null)
    }
  }

  async function handleRevoke(user: PairingUser) {
    setBusy(`revoke:${user.user_id}`)

    try {
      await revokePairing(platformId, user.user_id)
      notify({
        kind: 'success',
        title: copy.revokedToastTitle,
        message: copy.revokedToastMessage(pairingUserLabel(user), platform.name)
      })
      await loadPairing(false)
    } catch (err) {
      notifyError(err, copy.revokeFailed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-busy={loading || undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Users aria-hidden className="size-3.5" />
            {copy.title}
          </h4>
          <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
            {copy.description(platform.name)}
          </p>
        </div>
        <Button
          aria-label={copy.refresh}
          className="min-h-10"
          disabled={loading}
          onClick={() => void loadPairing(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw aria-hidden className="size-3.5" />
          {copy.refresh}
        </Button>
      </div>

      <form className="mt-3 space-y-1.5" onSubmit={handleApprove}>
        <label className="text-xs font-medium text-foreground" htmlFor={codeId}>
          {copy.codeLabel}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-describedby={formError ? errorId : undefined}
            aria-invalid={formError ? 'true' : undefined}
            autoComplete="one-time-code"
            className="h-10 font-mono uppercase"
            id={codeId}
            maxLength={16}
            onChange={event => {
              setCode(event.target.value.toUpperCase())
              setFormError('')
            }}
            placeholder={copy.codePlaceholder(platform.name)}
            spellCheck={false}
            type="text"
            value={code}
          />
          <Button className="min-h-10" disabled={!code.trim() || busy === 'approve'} type="submit">
            <Check aria-hidden className="size-3.5" />
            {busy === 'approve' ? copy.approving : copy.approve}
          </Button>
        </div>
        {formError && (
          <p className="text-xs text-destructive" id={errorId}>
            {formError}
          </p>
        )}
      </form>

      {loadError ? (
        <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">{copy.loadFailed}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.loadRetryHelp}</p>
          <Button
            className="mt-3 min-h-10"
            onClick={() => void loadPairing(true)}
            size="sm"
            type="button"
            variant="secondary"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            {copy.retry}
          </Button>
        </div>
      ) : loading ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          <PairingList
            empty={copy.emptyPending}
            items={pending}
            meta={user => copy.pendingMeta(user.code || 'pending', user.age_minutes ?? 0)}
            title={pendingTitle}
          />
          <PairingList
            action={user => (
              <Button
                aria-label={copy.revokeAria(pairingUserLabel(user))}
                className="min-h-10"
                disabled={busy === `revoke:${user.user_id}`}
                onClick={() => void handleRevoke(user)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden className="size-3.5" />
                {copy.revoke}
              </Button>
            )}
            empty={copy.emptyApproved}
            items={approved}
            meta={user => copy.approvedMeta(approvedTime(user))}
            title={approvedTitle}
          />
        </div>
      )}
    </section>
  )
}

function PairingList({
  action,
  empty,
  items,
  meta,
  title
}: {
  action?: (user: PairingUser) => ReactNode
  empty: string
  items: PairingUser[]
  meta: (user: PairingUser) => string
  title: string
}) {
  return (
    <div>
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/50 rounded-lg border border-border/60">
          {items.map(user => (
            <li
              className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              key={user.user_id}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{pairingUserLabel(user)}</span>
                <span className="mt-0.5 block truncate font-mono text-[0.68rem] text-muted-foreground">
                  {meta(user)}
                </span>
              </span>
              {action?.(user)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
