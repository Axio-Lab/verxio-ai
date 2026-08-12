import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { MessagingPlatformInfo } from '@/types/hermes'

export const WEBHOOK_DELIVERY_EXCLUDED = new Set(['webhook', 'api_server', 'msgraph_webhook'])

export type MessagingDeliveryStatus = 'ready' | 'no_home' | 'no_connection'

export interface MessagingDeliveryOption {
  homeName: string
  id: string
  label: string
  name: string
  status: MessagingDeliveryStatus
}

export function isMessagingPlatformConnected(platform: MessagingPlatformInfo): boolean {
  return platform.state === 'connected' || Boolean(platform.configured && platform.enabled)
}

export function messagingDeliveryOptions(platforms: MessagingPlatformInfo[]): MessagingDeliveryOption[] {
  return platforms
    .filter(platform => !WEBHOOK_DELIVERY_EXCLUDED.has(platform.id))
    .map(platform => {
      const connected = isMessagingPlatformConnected(platform)
      const homeName = platform.home_channel?.name?.trim() || ''
      const homeId = platform.home_channel?.chat_id?.trim() || ''
      const connection = platform.connections?.find(row => row.is_default) || platform.connections?.[0] || null
      const identity = (connection?.identity || connection?.label || '').trim()
      let status: MessagingDeliveryStatus = 'no_connection'

      if (connected && homeId) {
        status = 'ready'
      } else if (connected) {
        status = 'no_home'
      }

      const parts = [platform.name]

      if (identity && identity.toLowerCase() !== platform.name.toLowerCase()) {
        parts.push(identity)
      }

      if (homeName) {
        parts.push(`Home: ${homeName}`)
      }

      return {
        id: platform.id,
        name: platform.name,
        homeName,
        label: parts.join(' · '),
        status
      }
    })
}

export const CRON_LOCAL_DELIVER = 'local'

export function cronDeliverPlatformId(deliver: string): string {
  const first = deliver.split(',')[0]?.trim() || CRON_LOCAL_DELIVER

  if (!first || first === 'origin') {
    return CRON_LOCAL_DELIVER
  }

  return first.split(':')[0]?.trim() || CRON_LOCAL_DELIVER
}

export function cronDeliveryOptions(platforms: MessagingPlatformInfo[], localLabel: string): MessagingDeliveryOption[] {
  return [
    {
      homeName: '',
      id: CRON_LOCAL_DELIVER,
      label: localLabel,
      name: localLabel,
      status: 'ready'
    },
    ...messagingDeliveryOptions(platforms)
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

  return [
    ...options,
    {
      homeName: '',
      id: currentId,
      label: fallbackLabel,
      name: fallbackLabel,
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
        <SelectContent>
          {options.map(option => (
            <SelectItem disabled={option.status !== 'ready'} key={option.id} value={option.id}>
              {option.status === 'ready'
                ? option.label
                : option.status === 'no_home'
                  ? `${option.name} — ${w.noHomeChannel}`
                  : `${option.name} — ${w.noConnection}`}
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
