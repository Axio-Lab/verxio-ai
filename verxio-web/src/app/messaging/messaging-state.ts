import type { MessagingPlatformInfo } from '@/hermes'

type MessagingStateSource = Pick<
  MessagingPlatformInfo,
  'configured' | 'enabled' | 'error_code' | 'gateway_running' | 'id' | 'state'
>

export function effectiveMessagingState(platform: MessagingStateSource): MessagingPlatformInfo['state'] {
  if (platform.id === 'whatsapp' && platform.configured && platform.error_code === 'whatsapp_not_paired') {
    if (!platform.enabled) {
      return 'disabled'
    }

    return platform.gateway_running ? 'pending_restart' : 'gateway_stopped'
  }

  return platform.state
}
