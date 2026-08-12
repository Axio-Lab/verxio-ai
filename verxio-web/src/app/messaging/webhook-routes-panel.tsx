import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { writeClipboardText } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  createMessagingWebhook,
  deleteMessagingWebhook,
  enableMessagingWebhooks,
  getMessagingWebhooks,
  setMessagingWebhookEnabled
} from '@/hermes'
import { useI18n } from '@/i18n'
import { Copy, Plus, Trash2 } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import type { MessagingPlatformInfo, MessagingWebhookRoute } from '@/types/hermes'

import { ListRow } from '../settings/primitives'

import { messagingDeliveryOptions, MessagingDeliverySelect } from './messaging-delivery-select'

function SectionTitle({ children }: { children: string }) {
  return <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</h4>
}

export function WebhookRoutesPanel({
  onChanged,
  platform,
  platforms
}: {
  onChanged: () => Promise<void>
  platform: MessagingPlatformInfo
  platforms: MessagingPlatformInfo[]
}) {
  const { t } = useI18n()
  const w = t.messaging.webhooks
  const [routes, setRoutes] = useState<MessagingWebhookRoute[] | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [enabled, setEnabled] = useState(platform.enabled)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [events, setEvents] = useState('')
  const [deliver, setDeliver] = useState('')
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string; url: string } | null>(null)

  const options = useMemo(() => messagingDeliveryOptions(platforms), [platforms])
  const readyOptions = options.filter(option => option.status === 'ready')
  const selected = options.find(option => option.id === deliver)
  const selectedPlatform = platforms.find(row => row.id === deliver)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const result = await getMessagingWebhooks()

        if (cancelled) {
          return
        }

        setEnabled(result.enabled)
        setBaseUrl(result.base_url)
        setRoutes(result.subscriptions)
      } catch (err) {
        if (!cancelled) {
          notifyError(err, w.loadFailed)
          setRoutes([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [platform.enabled, w.loadFailed])

  async function refreshRoutes() {
    const result = await getMessagingWebhooks()
    setEnabled(result.enabled)
    setBaseUrl(result.base_url)
    setRoutes(result.subscriptions)
  }

  async function handleCreate() {
    const routeName = name.trim().toLowerCase().replace(/\s+/g, '-')

    if (!routeName) {
      notify({ kind: 'error', message: w.nameRequired })

      return
    }

    if (!selected || selected.status !== 'ready') {
      notify({ kind: 'error', message: w.deliverRequired })

      return
    }

    setBusy('create')

    try {
      if (!enabled) {
        await enableMessagingWebhooks()
        await onChanged()
      }

      const created = await createMessagingWebhook({
        name: routeName,
        prompt: prompt.trim(),
        events: events
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
        deliver: selected.id,
        deliver_chat_id: selectedPlatform?.home_channel?.chat_id
      })

      setName('')
      setPrompt('')
      setEvents('')

      if (created.secret) {
        setCreatedSecret({ name: created.name, secret: created.secret, url: created.url })
      }

      await refreshRoutes()
      notify({ kind: 'success', title: w.createdTitle, message: w.createdMessage(created.name) })
    } catch (err) {
      notifyError(err, w.createFailed)
    } finally {
      setBusy(null)
    }
  }

  async function handleCopy(label: string, value: string) {
    try {
      await writeClipboardText(value)
      notify({ kind: 'success', title: w.copiedTitle(label), message: w.copiedMessage })
    } catch (err) {
      notifyError(err, w.copyFailed)
    }
  }

  async function handleDelete(route: MessagingWebhookRoute) {
    setBusy(`delete:${route.name}`)

    try {
      await deleteMessagingWebhook(route.name)
      await refreshRoutes()
      notify({ kind: 'success', title: w.deletedTitle, message: w.deletedMessage(route.name) })
    } catch (err) {
      notifyError(err, w.deleteFailed)
    } finally {
      setBusy(null)
    }
  }

  async function handleToggleRoute(route: MessagingWebhookRoute, next: boolean) {
    setBusy(`toggle:${route.name}`)

    try {
      await setMessagingWebhookEnabled(route.name, next)
      await refreshRoutes()
    } catch (err) {
      notifyError(err, w.updateFailed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle>{w.title}</SectionTitle>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {w.description}
        </p>
        {!enabled && <p className="mt-2 text-xs text-muted-foreground">{w.enableHint}</p>}
      </section>

      {createdSecret && (
        <section className="rounded-md border border-border/60 bg-muted/30 px-3 py-3">
          <p className="text-sm font-medium">{w.secretOnceTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{w.secretOnceHint}</p>
          <div className="mt-3 grid gap-2">
            <CopyRow
              label={w.urlLabel}
              onCopy={() => void handleCopy(w.urlLabel, createdSecret.url)}
              value={createdSecret.url}
            />
            <CopyRow
              label={w.secretLabel}
              onCopy={() => void handleCopy(w.secretLabel, createdSecret.secret)}
              value={createdSecret.secret}
            />
          </div>
        </section>
      )}

      <section>
        <SectionTitle>{w.routesTitle}</SectionTitle>
        {loading || routes === null ? (
          <p className="mt-2 text-xs text-muted-foreground">{w.loadingRoutes}</p>
        ) : routes.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{w.emptyRoutes}</p>
        ) : (
          <div className="mt-3 grid gap-1">
            {routes.map(route => (
              <ListRow
                action={
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={route.enabled}
                      disabled={busy === `toggle:${route.name}`}
                      onCheckedChange={value => void handleToggleRoute(route, value)}
                      size="xs"
                    />
                    <Button
                      className="size-8 shrink-0"
                      onClick={() => void handleCopy(w.urlLabel, route.url)}
                      title={w.copyUrl}
                      variant="ghost"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      className="size-8 shrink-0"
                      disabled={busy === `delete:${route.name}`}
                      onClick={() => void handleDelete(route)}
                      title={w.deleteRoute}
                      variant="ghost"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                }
                description={route.url}
                key={route.name}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{route.name}</span>
                    <span className="text-[0.66rem] font-medium text-muted-foreground">
                      {w.deliversTo(route.deliver || '')}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>{w.createTitle}</SectionTitle>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {w.createHint}
        </p>
        {readyOptions.length === 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{w.needConnectedChannel}</p>
        )}
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-xs font-medium" htmlFor="webhook-name">
            {w.nameLabel}
            <Input
              id="webhook-name"
              onChange={event => setName(event.target.value)}
              placeholder={w.namePlaceholder}
              value={name}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor="webhook-events">
            {w.eventsLabel}
            <Input
              id="webhook-events"
              onChange={event => setEvents(event.target.value)}
              placeholder={w.eventsPlaceholder}
              value={events}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor="webhook-prompt">
            {w.promptLabel}
            <Textarea
              className="min-h-20"
              id="webhook-prompt"
              onChange={event => setPrompt(event.target.value)}
              placeholder={w.promptPlaceholder}
              value={prompt}
            />
          </label>
          <div className="grid gap-1 text-xs font-medium">
            <span>{w.deliverLabel}</span>
            <MessagingDeliverySelect onChange={setDeliver} options={options} value={deliver} />
          </div>
          <div>
            <Button
              disabled={busy === 'create' || readyOptions.length === 0}
              onClick={() => void handleCreate()}
              size="sm"
            >
              <Plus />
              {busy === 'create' ? w.creating : w.createAction}
            </Button>
          </div>
        </div>
        {baseUrl && (
          <p className="mt-3 text-xs text-muted-foreground">
            {w.publicUrlHint}: <span className="wrap-anywhere font-mono">{baseUrl}/&lt;route&gt;</span>
          </p>
        )}
      </section>
    </div>
  )
}

function CopyRow({ label, onCopy, value }: { label: string; onCopy: () => void; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="wrap-anywhere font-mono text-xs">{value}</p>
      </div>
      <Button className="size-8 shrink-0" onClick={onCopy} variant="ghost">
        <Copy className="size-3.5" />
      </Button>
    </div>
  )
}
