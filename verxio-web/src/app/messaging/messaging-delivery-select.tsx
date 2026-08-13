import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { MessagingConnectionInfo, MessagingPlatformInfo } from '@/types/hermes'

export const WEBHOOK_DELIVERY_EXCLUDED = new Set(['webhook', 'api_server', 'msgraph_webhook'])

export const MESSAGING_DELIVERY_CONN_SEP = '::'

export type MessagingDeliveryStatus = 'ready' | 'no_home' | 'no_connection'

export interface MessagingDeliveryOption {
  chatId: string
  connectionId: string | null
  homeName: string
  id: string
  label: string
  name: string
  platformId: string
  status: MessagingDeliveryStatus
}

export function isDefaultMessagingConnection(connectionId: string | null | undefined): boolean {
  return !connectionId || connectionId === 'default'
}

export function messagingDeliveryOptionId(platformId: string, connectionId?: string | null): string {
  if (isDefaultMessagingConnection(connectionId)) {
    return platformId
  }

  return `${platformId}${MESSAGING_DELIVERY_CONN_SEP}${connectionId}`
}

export function parseMessagingDeliveryId(value: string): { connectionId: string | null; platformId: string } {
  const trimmed = value.trim()
  const sep = trimmed.indexOf(MESSAGING_DELIVERY_CONN_SEP)

  if (sep <= 0) {
    return { platformId: trimmed, connectionId: null }
  }

  const platformId = trimmed.slice(0, sep).trim()
  const connectionId = trimmed.slice(sep + MESSAGING_DELIVERY_CONN_SEP.length).trim()

  return {
    platformId,
    connectionId: isDefaultMessagingConnection(connectionId) ? null : connectionId
  }
}

export function isMessagingPlatformConnected(platform: MessagingPlatformInfo): boolean {
  return platform.state === 'connected' || Boolean(platform.configured && platform.enabled)
}

function isMessagingConnectionReady(connection: MessagingConnectionInfo): boolean {
  return Boolean(connection.configured && connection.enabled !== false)
}

function deliveryStatus(connected: boolean, homeId: string): MessagingDeliveryStatus {
  if (connected && homeId) {
    return 'ready'
  }

  if (connected) {
    return 'no_home'
  }

  return 'no_connection'
}

function connectionIdentity(connection: MessagingConnectionInfo | null | undefined): string {
  return (connection?.identity || connection?.label || '').trim()
}

function deliveryLabel(platformName: string, identity: string, homeName: string): string {
  const parts = [platformName]

  if (identity && identity.toLowerCase() !== platformName.toLowerCase()) {
    parts.push(identity)
  }

  if (homeName) {
    parts.push(`Home: ${homeName}`)
  }

  return parts.join(' · ')
}

function optionFromPlatform(
  platform: MessagingPlatformInfo,
  connection: MessagingConnectionInfo | null
): MessagingDeliveryOption {
  const homeName = platform.home_channel?.name?.trim() || ''
  const chatId = platform.home_channel?.chat_id?.trim() || ''
  const connected = connection ? isMessagingConnectionReady(connection) : isMessagingPlatformConnected(platform)
  const identity = connectionIdentity(connection)
  const connectionId = connection && !isDefaultMessagingConnection(connection.id) ? connection.id : null

  return {
    id: messagingDeliveryOptionId(platform.id, connectionId),
    platformId: platform.id,
    connectionId,
    chatId,
    name: platform.name,
    homeName,
    label: deliveryLabel(platform.name, identity, homeName),
    status: deliveryStatus(connected, chatId)
  }
}

const STATUS_ORDER: Record<MessagingDeliveryStatus, number> = {
  ready: 0,
  no_home: 1,
  no_connection: 2
}

export function messagingDeliveryOptions(platforms: MessagingPlatformInfo[]): MessagingDeliveryOption[] {
  const options = platforms
    .filter(platform => !WEBHOOK_DELIVERY_EXCLUDED.has(platform.id))
    .flatMap(platform => {
      const connections = platform.connections?.filter(Boolean) || []

      if (connections.length === 0) {
        return [optionFromPlatform(platform, null)]
      }

      return connections.map(connection => optionFromPlatform(platform, connection))
    })

  return options.sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status])
}

export const CRON_LOCAL_DELIVER = 'local'

export function cronDeliverPlatformId(deliver: string): string {
  const first = deliver.split(',')[0]?.trim() || CRON_LOCAL_DELIVER

  if (!first || first === 'origin') {
    return CRON_LOCAL_DELIVER
  }

  if (first.includes(MESSAGING_DELIVERY_CONN_SEP)) {
    return parseMessagingDeliveryId(first).platformId || CRON_LOCAL_DELIVER
  }

  return first.split(':')[0]?.trim() || CRON_LOCAL_DELIVER
}

export function cronDeliveryOptions(platforms: MessagingPlatformInfo[], localLabel: string): MessagingDeliveryOption[] {
  return [
    {
      chatId: '',
      connectionId: null,
      homeName: '',
      id: CRON_LOCAL_DELIVER,
      label: localLabel,
      name: localLabel,
      platformId: CRON_LOCAL_DELIVER,
      status: 'ready'
    },
    ...messagingDeliveryOptions(platforms).filter(option => isDefaultMessagingConnection(option.connectionId))
  ]
}

export function withCurrentDeliveryOption(
  options: MessagingDeliveryOption[],
  currentId: string,
  fallbackLabel: string
): MessagingDeliveryOption[] {
  if (!currentId || options.some(option => option.id === currentId)) {
    return options
  }

  const parsed = parseMessagingDeliveryId(currentId)

  return [
    ...options,
    {
      chatId: '',
      connectionId: parsed.connectionId,
      homeName: '',
      id: currentId,
      label: fallbackLabel,
      name: fallbackLabel,
      platformId: parsed.platformId || currentId,
      status: 'ready'
    }
  ]
}

export function MessagingDeliverySelect({
  onChange,
  options,
  selectId = 'webhook-deliver',
  value
}: {
  onChange: (platformId: string) => void
  options: MessagingDeliveryOption[]
  selectId?: string
  value: string
}) {
  const { t } = useI18n()
  const w = t.messaging.webhooks
  const selected = options.find(option => option.id === value)

  return (
    <div className="space-y-1.5">
      <Select onValueChange={onChange} value={value || undefined}>
        <SelectTrigger className="h-9 rounded-md" id={selectId}>
          <SelectValue placeholder={w.deliverPlaceholder} />
        </SelectTrigger>
        <SelectContent avoidCollisions={false} side="bottom">
          {options.map(option => (
            <SelectItem disabled={option.status !== 'ready'} key={option.id} value={option.id}>
              {option.status === 'ready'
                ? option.label
                : option.status === 'no_home'
                  ? `${option.label || option.name} — ${w.noHomeChannel}`
                  : `${option.label || option.name} — ${w.noConnection}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected?.status === 'no_home' && (
        <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-amber-700 dark:text-amber-300">
          {w.setHomeChannel(selected.name)}
        </p>
      )}
      {selected?.status === 'no_connection' && (
        <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-muted-foreground">
          {w.connectFirst(selected.name)}
        </p>
      )}
    </div>
  )
}
