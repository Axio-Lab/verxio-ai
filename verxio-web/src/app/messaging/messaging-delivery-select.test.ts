import { describe, expect, it } from 'vitest'

import type { MessagingPlatformInfo } from '@/types/hermes'

import {
  cronDeliverPlatformId,
  cronDeliveryOptions,
  messagingDeliveryOptionId,
  messagingDeliveryOptions,
  parseMessagingDeliveryId,
  withCurrentDeliveryOption
} from './messaging-delivery-select'

function platform(
  partial: Partial<MessagingPlatformInfo> & Pick<MessagingPlatformInfo, 'id' | 'name'>
): MessagingPlatformInfo {
  return {
    configured: false,
    description: '',
    docs_url: '',
    enabled: false,
    env_vars: [],
    gateway_running: true,
    ...partial
  }
}

describe('messagingDeliveryOptions', () => {
  it('marks connected platforms with a home channel as ready', () => {
    const options = messagingDeliveryOptions([
      platform({
        id: 'telegram',
        name: 'Telegram',
        state: 'connected',
        configured: true,
        enabled: true,
        home_channel: { chat_id: '1', name: 'Donatus', platform: 'telegram' },
        connections: [{ id: 'default', label: '@MyBot', configured: true, enabled: true, env_vars: [] }]
      })
    ])

    expect(options[0]?.status).toBe('ready')
    expect(options[0]?.id).toBe('telegram')
    expect(options[0]?.label).toContain('Telegram')
    expect(options[0]?.label).toContain('@MyBot')
    expect(options[0]?.label).toContain('Home: Donatus')
  })

  it('lists every Telegram or WhatsApp connection instead of only the default', () => {
    const options = messagingDeliveryOptions([
      platform({
        id: 'telegram',
        name: 'Telegram',
        state: 'connected',
        configured: true,
        enabled: true,
        home_channel: { chat_id: '1', name: 'Home', platform: 'telegram' },
        connections: [
          {
            id: 'default',
            label: 'Support',
            identity: '@VerxioSupportBot',
            configured: true,
            enabled: true,
            is_default: true,
            env_vars: []
          },
          {
            id: 'conn_sales',
            label: 'Sales',
            identity: '@VerxioSalesBot',
            configured: true,
            enabled: true,
            env_vars: []
          }
        ]
      }),
      platform({
        id: 'whatsapp',
        name: 'WhatsApp',
        state: 'connected',
        configured: true,
        enabled: true,
        home_channel: { chat_id: '1555', name: 'Ops', platform: 'whatsapp' },
        connections: [
          { id: 'default', label: 'Personal', identity: '+15550001', configured: true, enabled: true, env_vars: [] },
          { id: 'conn_work', label: 'Work', identity: '+15550002', configured: true, enabled: true, env_vars: [] }
        ]
      })
    ])

    expect(options.map(option => option.id)).toEqual([
      'telegram',
      'telegram::conn_sales',
      'whatsapp',
      'whatsapp::conn_work'
    ])
    expect(options[0]?.label).toContain('@VerxioSupportBot')
    expect(options[1]?.label).toContain('@VerxioSalesBot')
    expect(options[2]?.label).toContain('+15550001')
    expect(options[3]?.label).toContain('+15550002')
  })

  it('marks connected platforms without a home channel', () => {
    const options = messagingDeliveryOptions([
      platform({
        id: 'whatsapp',
        name: 'WhatsApp',
        state: 'connected',
        configured: true,
        enabled: true
      })
    ])

    expect(options[0]?.status).toBe('no_home')
  })

  it('marks disconnected platforms as no connection and skips webhook itself', () => {
    const options = messagingDeliveryOptions([
      platform({ id: 'slack', name: 'Slack', state: 'not_configured' }),
      platform({ id: 'webhook', name: 'Webhooks', enabled: true, configured: true, state: 'connected' })
    ])

    expect(options.map(option => option.id)).toEqual(['slack'])
    expect(options[0]?.status).toBe('no_connection')
  })

  it('sorts ready connections above disconnected platforms', () => {
    const options = messagingDeliveryOptions([
      platform({ id: 'slack', name: 'Slack', state: 'not_configured' }),
      platform({
        id: 'telegram',
        name: 'Telegram',
        state: 'connected',
        configured: true,
        enabled: true,
        home_channel: { chat_id: '1', name: 'Home', platform: 'telegram' }
      })
    ])

    expect(options.map(option => option.id)).toEqual(['telegram', 'slack'])
  })
})

describe('parseMessagingDeliveryId', () => {
  it('keeps default platform ids and splits extra connection ids', () => {
    expect(parseMessagingDeliveryId('telegram')).toEqual({ platformId: 'telegram', connectionId: null })
    expect(parseMessagingDeliveryId('telegram::conn_sales')).toEqual({
      platformId: 'telegram',
      connectionId: 'conn_sales'
    })
    expect(messagingDeliveryOptionId('telegram', 'default')).toBe('telegram')
    expect(messagingDeliveryOptionId('telegram', 'conn_sales')).toBe('telegram::conn_sales')
  })
})

describe('cronDeliveryOptions', () => {
  it('prepends a ready local option before messaging platforms', () => {
    const options = cronDeliveryOptions(
      [
        platform({
          id: 'telegram',
          name: 'Telegram',
          state: 'connected',
          configured: true,
          enabled: true,
          home_channel: { chat_id: '1', name: 'Donatus', platform: 'telegram' }
        })
      ],
      'This desktop'
    )

    expect(options[0]).toMatchObject({ id: 'local', label: 'This desktop', status: 'ready' })
    expect(options[1]?.id).toBe('telegram')
    expect(options[1]?.status).toBe('ready')
  })

  it('keeps cron on the default connection per platform', () => {
    const options = cronDeliveryOptions(
      [
        platform({
          id: 'telegram',
          name: 'Telegram',
          state: 'connected',
          configured: true,
          enabled: true,
          home_channel: { chat_id: '1', name: 'Home', platform: 'telegram' },
          connections: [
            { id: 'default', label: '@Support', configured: true, enabled: true, env_vars: [] },
            { id: 'conn_sales', label: '@Sales', configured: true, enabled: true, env_vars: [] }
          ]
        })
      ],
      'This desktop'
    )

    expect(options.map(option => option.id)).toEqual(['local', 'telegram'])
  })
})

describe('cronDeliverPlatformId', () => {
  it('normalizes origin, chat-scoped, and comma-separated deliver values', () => {
    expect(cronDeliverPlatformId('')).toBe('local')
    expect(cronDeliverPlatformId('origin')).toBe('local')
    expect(cronDeliverPlatformId('telegram:-100123:17585')).toBe('telegram')
    expect(cronDeliverPlatformId('discord,#engineering')).toBe('discord')
    expect(cronDeliverPlatformId('telegram::conn_sales')).toBe('telegram')
  })
})

describe('withCurrentDeliveryOption', () => {
  it('keeps an unknown current value visible in the picker', () => {
    const options = withCurrentDeliveryOption(cronDeliveryOptions([], 'This desktop'), 'all', 'all')
    expect(options.map(option => option.id)).toEqual(['local', 'all'])
  })
})
