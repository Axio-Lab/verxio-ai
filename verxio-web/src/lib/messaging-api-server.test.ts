import { describe, expect, it } from 'vitest'

import type { MessagingPlatformInfo } from '@/types/hermes'

import { messagingApiServerFromPlatforms } from './messaging-api-server'

function platform(partial: Partial<MessagingPlatformInfo>): MessagingPlatformInfo {
  return {
    configured: false,
    description: '',
    docs_url: '',
    enabled: false,
    env_vars: [],
    gateway_running: false,
    id: 'api_server',
    name: 'API server',
    ...partial
  }
}

describe('messagingApiServerFromPlatforms', () => {
  it('uses the desktop gateway defaults when the platform is unset', () => {
    const info = messagingApiServerFromPlatforms([platform({ enabled: false })])

    expect(info.enabled).toBe(false)
    expect(info.base_url).toBe('http://127.0.0.1:8642/v1')
    expect(info.model).toBe('verxio')
    expect(info.example).toContain('http://127.0.0.1:8642/v1/chat/completions')
    expect(info.example).toContain('$API_SERVER_KEY')
  })

  it('reads the configured host, port, and model', () => {
    const info = messagingApiServerFromPlatforms([
      platform({
        enabled: true,
        env_vars: [
          {
            advanced: false,
            current_value: '0.0.0.0',
            description: '',
            is_password: false,
            is_set: true,
            key: 'API_SERVER_HOST',
            prompt: '',
            redacted_value: null,
            required: false,
            url: null
          },
          {
            advanced: false,
            current_value: '9000',
            description: '',
            is_password: false,
            is_set: true,
            key: 'API_SERVER_PORT',
            prompt: '',
            redacted_value: null,
            required: false,
            url: null
          },
          {
            advanced: false,
            current_value: 'desk',
            description: '',
            is_password: false,
            is_set: true,
            key: 'API_SERVER_MODEL_NAME',
            prompt: '',
            redacted_value: null,
            required: false,
            url: null
          }
        ]
      })
    ])

    expect(info.enabled).toBe(true)
    expect(info.base_url).toBe('http://127.0.0.1:9000/v1')
    expect(info.model).toBe('desk')
  })
})
