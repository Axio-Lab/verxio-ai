import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { CalendarDays, Link2, Share2, Trash2 } from '@/lib/icons'
import {
  disablePostiz,
  enablePostiz,
  getPostizCalendarSession,
  getPostizStatus,
  listPostizIntegrations,
  listPostizPosts,
  openPostizConnectUrl,
  type PostizIntegration,
  type PostizPost,
  type PostizStatusResponse,
  removePostizIntegration
} from '@/lib/verxio-api'
import { notify, notifyError } from '@/store/notifications'

import { EmptyState, ListRow, LoadingState, Pill, SectionHeading, SettingsContent } from './primitives'

const CONNECT_PROVIDERS = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'linkedin-page', label: 'LinkedIn Page' },
  { id: 'x', label: 'X' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'threads', label: 'Threads' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'discord', label: 'Discord' },
  { id: 'slack', label: 'Slack' }
] as const

function statusTone(status: string | undefined): 'muted' | 'primary' {
  return status === 'active' ? 'primary' : 'muted'
}

function statusLabel(
  s: PostizStatusResponse | null,
  copy: { ready: string; needsKey: string; disabled: string; unavailable: string }
) {
  if (!s?.configured) {
    return copy.unavailable
  }

  const status = s.binding?.status

  if (status === 'active') {
    return copy.ready
  }

  if (status === 'needs_api_key') {
    return copy.needsKey
  }

  if (!status || status === 'disabled') {
    return copy.disabled
  }

  return status
}

export function SocialsSettings() {
  const { t } = useI18n()
  const s = t.settings.socials
  const [status, setStatus] = useState<PostizStatusResponse | null>(null)
  const [integrations, setIntegrations] = useState<PostizIntegration[]>([])
  const [posts, setPosts] = useState<PostizPost[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarUrl, setCalendarUrl] = useState('')
  const [disconnectId, setDisconnectId] = useState<string | null>(null)

  const enabled = Boolean(status?.binding && ['active', 'needs_api_key'].includes(status.binding.status))

  const refresh = useCallback(async () => {
    const next = await getPostizStatus()

    setStatus(next)

    if (next.binding && ['active', 'needs_api_key'].includes(next.binding.status)) {
      try {
        setIntegrations(await listPostizIntegrations())
        setPosts((await listPostizPosts()).slice(0, 5))
      } catch {
        setIntegrations([])
        setPosts([])
      }
    } else {
      setIntegrations([])
      setPosts([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    refresh()
      .catch(err => notifyError(err, s.failedLoad))
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [refresh, s.failedLoad])

  const onEnable = async () => {
    setBusy(true)

    try {
      const next = await enablePostiz()

      setStatus(next)
      await refresh()
      notify({ title: s.enabledTitle, message: s.enabledMessage })
    } catch (err) {
      notifyError(err, s.enableFailed)
    } finally {
      setBusy(false)
    }
  }

  const onDisable = async () => {
    setBusy(true)

    try {
      const next = await disablePostiz()

      setStatus(next)
      setIntegrations([])
      setPosts([])
      notify({ title: s.disabledTitle, message: s.disabledMessage })
    } catch (err) {
      notifyError(err, s.disableFailed)
      throw err instanceof Error ? err : new Error(s.disableFailed)
    } finally {
      setBusy(false)
    }
  }

  const onOpenCalendar = async () => {
    setBusy(true)

    try {
      const session = await getPostizCalendarSession()

      setCalendarUrl(session.url || status?.publicUrl || 'http://127.0.0.1:4007')
      setCalendarOpen(true)
    } catch (err) {
      notifyError(err, s.calendarFailed)
    } finally {
      setBusy(false)
    }
  }

  const onConnect = async (providerId: string) => {
    setBusy(true)

    try {
      const { url } = await openPostizConnectUrl(providerId)

      window.open(url, '_blank', 'noopener,noreferrer')
      setConnectOpen(false)
      notify({ title: s.connectOpenedTitle, message: s.connectOpenedMessage })

      window.setTimeout(() => {
        void refresh().catch(() => undefined)
      }, 2500)
    } catch (err) {
      notifyError(err, s.connectFailed)
    } finally {
      setBusy(false)
    }
  }

  const onDisconnect = async () => {
    if (!disconnectId) {
      return
    }

    setBusy(true)

    try {
      await removePostizIntegration(disconnectId)
      await refresh()
      notify({ title: s.disconnectedTitle, message: s.disconnectedMessage })
    } catch (err) {
      notifyError(err, s.disconnectFailed)
      throw err instanceof Error ? err : new Error(s.disconnectFailed)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <LoadingState label={s.loading} />
  }

  return (
    <SettingsContent>
      <SectionHeading icon={Share2} meta={statusLabel(status, s)} title={s.title} />
      <p className="mb-4 text-sm text-muted-foreground">{s.intro}</p>

      <ListRow
        action={
          enabled ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void onOpenCalendar()} size="sm" type="button" variant="secondary">
                <CalendarDays className="size-3.5" />
                {s.openCalendar}
              </Button>
              <Button disabled={busy} onClick={() => setConnectOpen(true)} size="sm" type="button">
                <Link2 className="size-3.5" />
                {s.connectChannel}
              </Button>
              <Button disabled={busy} onClick={() => setConfirmDisable(true)} size="sm" type="button" variant="ghost">
                {s.disable}
              </Button>
            </div>
          ) : (
            <Button disabled={busy || !status?.configured} onClick={() => void onEnable()} size="sm" type="button">
              {s.enable}
            </Button>
          )
        }
        description={enabled ? s.enabledDescription : s.disabledDescription}
        title={s.setupTitle}
      />

      {!status?.configured && <EmptyState description={s.notConfigured} title={s.unavailable} />}

      {enabled && (
        <>
          <SectionHeading icon={Link2} meta={String(integrations.length)} title={s.channelsTitle} />
          {integrations.length === 0 ? (
            <EmptyState description={s.noChannels} title={s.noChannelsTitle} />
          ) : (
            <div className="flex flex-col gap-2">
              {integrations.map(item => (
                <ListRow
                  action={
                    <Button
                      disabled={busy}
                      onClick={() => setDisconnectId(item.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="size-3.5" />
                      {s.disconnect}
                    </Button>
                  }
                  description={item.identifier || item.providerIdentifier || item.name}
                  key={item.id}
                  title={
                    <span className="inline-flex items-center gap-2">
                      {item.name || item.providerIdentifier || item.id}
                      <Pill tone={statusTone(item.disabled ? 'disabled' : 'active')}>
                        {item.disabled ? s.channelDisabled : s.channelActive}
                      </Pill>
                    </span>
                  }
                />
              ))}
            </div>
          )}

          <SectionHeading icon={CalendarDays} meta={String(posts.length)} title={s.postsTitle} />
          {posts.length === 0 ? (
            <EmptyState description={s.noPosts} title={s.noPostsTitle} />
          ) : (
            <div className="flex flex-col gap-2">
              {posts.map(item => (
                <ListRow
                  description={item.content || item.text || item.id}
                  key={item.id}
                  title={
                    <span className="inline-flex items-center gap-2">
                      {item.publishDate || item.scheduledAt || item.createdAt || s.unscheduledPost}
                      <Pill tone={statusTone(item.status || item.state)}>
                        {item.status || item.state || s.draftPost}
                      </Pill>
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        busyLabel={t.common.loading}
        confirmLabel={s.disable}
        destructive
        onClose={() => setConfirmDisable(false)}
        onConfirm={onDisable}
        open={confirmDisable}
        title={s.disableConfirm}
      />

      <ConfirmDialog
        busyLabel={t.common.loading}
        confirmLabel={s.disconnect}
        destructive
        onClose={() => setDisconnectId(null)}
        onConfirm={onDisconnect}
        open={Boolean(disconnectId)}
        title={s.disconnectConfirm}
      />

      <Dialog onOpenChange={setConnectOpen} open={connectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{s.connectTitle}</DialogTitle>
            <DialogDescription>{s.connectDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto py-2">
            {CONNECT_PROVIDERS.map(provider => (
              <Button
                disabled={busy}
                key={provider.id}
                onClick={() => void onConnect(provider.id)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {provider.label}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setConnectOpen(false)} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setCalendarOpen} open={calendarOpen}>
        <DialogContent className="flex h-[min(85vh,720px)] max-w-5xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{s.calendarTitle}</DialogTitle>
            <DialogDescription>{s.calendarDescription}</DialogDescription>
          </DialogHeader>
          {calendarUrl ? (
            <iframe
              className="min-h-0 w-full flex-1 rounded-md border border-border/60 bg-background"
              src={calendarUrl}
              title={s.calendarTitle}
            />
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              onClick={() => {
                if (calendarUrl) {
                  window.open(calendarUrl, '_blank', 'noopener,noreferrer')
                }
              }}
              type="button"
              variant="secondary"
            >
              {s.openInNewWindow}
            </Button>
            <Button onClick={() => setCalendarOpen(false)} type="button" variant="ghost">
              {t.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsContent>
  )
}
