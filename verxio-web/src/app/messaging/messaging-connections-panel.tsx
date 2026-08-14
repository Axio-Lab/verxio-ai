import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { writeClipboardText } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { createMessagingConnection, deleteMessagingConnection, updateMessagingConnection } from '@/hermes'
import { Copy, Plus, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { runGatewayRestart } from '@/store/system-actions'
import type { MessagingConnectionInfo, MessagingPlatformInfo } from '@/types/hermes'

import { CREDENTIAL_CONTROL_CLASS } from '../settings/credential-key-ui'

const PRIMARY_TOKEN_KEY: Record<string, string> = {
  api_server: 'API_SERVER_KEY',
  discord: 'DISCORD_BOT_TOKEN',
  slack: 'SLACK_BOT_TOKEN',
  telegram: 'TELEGRAM_BOT_TOKEN',
  webhook: 'WEBHOOK_SECRET',
  whatsapp_cloud: 'WHATSAPP_CLOUD_PHONE_NUMBER_ID'
}

interface MessagingConnectionsPanelProps {
  onChanged: () => Promise<void>
  platform: MessagingPlatformInfo
  selectedConnectionId: string | null
  onSelectConnection: (connectionId: string) => void
}

export function MessagingConnectionsPanel({
  onChanged,
  onSelectConnection,
  platform,
  selectedConnectionId
}: MessagingConnectionsPanelProps) {
  const connections = platform.connections || []
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [createdSecret, setCreatedSecret] = useState<{ label: string; secret: string } | null>(null)

  const primaryKey = PRIMARY_TOKEN_KEY[platform.id] || ''
  const autoGeneratesSecret = platform.id === 'webhook' || platform.id === 'api_server'
  const needsGatewayRestart = platform.id !== 'webhook' && platform.id !== 'api_server'
  const tokenLabel = useMemo(() => {
    if (platform.id === 'slack') {
      return 'Bot token (xoxb-…)'
    }

    if (platform.id === 'whatsapp_cloud') {
      return 'Phone number ID'
    }

    if (platform.id === 'whatsapp') {
      return ''
    }

    if (platform.id === 'webhook') {
      return 'HMAC secret (optional — leave blank to auto-generate)'
    }

    if (platform.id === 'api_server') {
      return 'API key (optional — leave blank to auto-generate)'
    }

    return 'Bot token'
  }, [platform.id])

  if (!platform.supports_multiple_connections) {
    return null
  }

  async function handleAdd() {
    const trimmedToken = token.trim()
    const trimmedLabel = label.trim() || `Connection ${connections.length + 1}`

    if (platform.id !== 'whatsapp' && primaryKey && !trimmedToken && !autoGeneratesSecret) {
      notify({ kind: 'error', message: 'Enter credentials for the new connection' })

      return
    }

    setBusy('add')

    try {
      const env = primaryKey && trimmedToken ? { [primaryKey]: trimmedToken } : {}
      const result = await createMessagingConnection(platform.id, {
        label: trimmedLabel,
        env
      })
      setAdding(false)
      setLabel('')
      setToken('')
      await onChanged()
      onSelectConnection(result.connection.id)
      if (result.connection.secret) {
        setCreatedSecret({ label: trimmedLabel, secret: result.connection.secret })
      }
      if (needsGatewayRestart) {
        await runGatewayRestart()
      }
      notify({
        kind: 'success',
        title: 'Connection added',
        message: needsGatewayRestart ? `${trimmedLabel} saved. Gateway restarting…` : `${trimmedLabel} saved.`
      })
    } catch (error) {
      notifyError(error, 'Could not add connection')
    } finally {
      setBusy(null)
    }
  }

  async function handleToggle(connection: MessagingConnectionInfo, enabled: boolean) {
    setBusy(`toggle:${connection.id}`)

    try {
      await updateMessagingConnection(platform.id, connection.id, { enabled })
      await onChanged()
      notify({
        kind: 'success',
        title: enabled ? 'Connection enabled' : 'Connection disabled',
        message: connection.label
      })
    } catch (error) {
      notifyError(error, 'Could not update connection')
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete(connection: MessagingConnectionInfo) {
    if (connection.is_default) {
      return
    }

    setBusy(`delete:${connection.id}`)

    try {
      await deleteMessagingConnection(platform.id, connection.id)
      await onChanged()

      if (selectedConnectionId === connection.id) {
        onSelectConnection(connections.find(row => row.is_default)?.id || connections[0]?.id || '')
      }

      if (needsGatewayRestart) {
        await runGatewayRestart()
      }
      notify({
        kind: 'success',
        title: 'Connection removed',
        message: connection.label
      })
    } catch (error) {
      notifyError(error, 'Could not remove connection')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[0.8125rem] font-semibold tracking-tight">Connections</h4>
        <Button
          disabled={busy !== null}
          onClick={() => setAdding(current => !current)}
          size="sm"
          type="button"
          variant="textStrong"
        >
          <Plus className="size-3.5" />
          Add connection
        </Button>
      </div>
      <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {platform.id === 'webhook'
          ? 'Named webhook identities. Each has its own secret and routes, on the same listener.'
          : platform.id === 'api_server'
            ? 'Named API keys. Each client uses its own Bearer token on the same public URL.'
            : 'Connected accounts for this gateway. Replies always go out on the same connection that received the message.'}
      </p>

      {createdSecret ? (
        <div className="mt-3 rounded-md border border-border/60 bg-muted/30 px-3 py-3">
          <p className="text-sm font-medium">Copy this secret now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Verxio shows the {platform.id === 'api_server' ? 'API key' : 'signing secret'} once for{' '}
            {createdSecret.label}.
          </p>
          <div className="mt-2 flex items-start gap-2">
            <p className="min-w-0 flex-1 wrap-anywhere font-mono text-xs">{createdSecret.secret}</p>
            <Button
              className="size-8 shrink-0"
              onClick={() => {
                void writeClipboardText(createdSecret.secret).then(
                  () => notify({ kind: 'success', title: 'Secret copied', message: 'Ready to paste.' }),
                  () => notify({ kind: 'error', title: 'Could not copy', message: 'Could not copy' })
                )
              }}
              type="button"
              variant="ghost"
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="mt-3 grid gap-1">
        {connections.map(connection => {
          const active = selectedConnectionId === connection.id

          return (
            <li key={connection.id}>
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors',
                  active
                    ? 'border-(--stroke-nous) bg-(--ui-row-active-background)'
                    : 'border-transparent hover:bg-(--ui-row-hover-background)'
                )}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelectConnection(connection.id)}
                  type="button"
                >
                  <div className="truncate text-[length:var(--conversation-text-font-size)] font-medium">
                    {connection.label}
                    {connection.is_default ? (
                      <span className="ml-1.5 text-[0.7rem] font-normal text-muted-foreground">default</span>
                    ) : null}
                  </div>
                  <div className="truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                    {connection.identity || connection.state || (connection.configured ? 'configured' : 'needs setup')}
                  </div>
                </button>
                <Switch
                  checked={connection.enabled}
                  disabled={busy !== null}
                  onCheckedChange={checked => void handleToggle(connection, checked)}
                />
                {!connection.is_default && (
                  <Button
                    aria-label={`Remove ${connection.label}`}
                    disabled={busy !== null}
                    onClick={() => void handleDelete(connection)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {adding && (
        <div className="mt-3 space-y-2 rounded-md border border-(--stroke-nous) p-3">
          <Input
            className={CREDENTIAL_CONTROL_CLASS}
            onChange={event => setLabel(event.target.value)}
            placeholder="Label (optional)"
            value={label}
          />
          {platform.id !== 'whatsapp' && primaryKey && (
            <Input
              className={CREDENTIAL_CONTROL_CLASS}
              onChange={event => setToken(event.target.value)}
              placeholder={tokenLabel}
              type={platform.id === 'whatsapp_cloud' ? 'text' : 'password'}
              value={token}
            />
          )}
          {platform.id === 'whatsapp' && (
            <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              After adding, select the new connection and scan its QR code to pair another number.
            </p>
          )}
          {platform.id === 'whatsapp_cloud' && (
            <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              App-level verify token and app secret stay shared. Add each phone number ID here, then save its access
              token in the connection fields below.
            </p>
          )}
          {platform.id === 'webhook' && (
            <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              Leave the secret blank to auto-generate one. New routes on this connection can reuse it.
            </p>
          )}
          {platform.id === 'api_server' && (
            <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              Leave the key blank to auto-generate one. Clients authenticate with this Bearer token on the same API URL.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={busy !== null} onClick={() => void handleAdd()} size="sm" type="button">
              Save connection
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
