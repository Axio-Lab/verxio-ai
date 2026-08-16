import { describe, expect, it } from 'vitest'

import { effectiveMessagingState } from './messaging-state'

const whatsapp = {
  configured: true,
  enabled: true,
  error_code: 'whatsapp_not_paired' as const,
  gateway_running: true,
  id: 'whatsapp',
  state: 'fatal'
}

describe('effectiveMessagingState', () => {
  it('does not treat a paired WhatsApp session as a fatal error', () => {
    expect(effectiveMessagingState(whatsapp)).toBe('pending_restart')
  })

  it('keeps a real WhatsApp bridge failure as fatal', () => {
    expect(
      effectiveMessagingState({
        ...whatsapp,
        error_code: 'whatsapp_bridge_exited'
      })
    ).toBe('fatal')
  })

  it('leaves other platforms unchanged', () => {
    expect(
      effectiveMessagingState({
        configured: true,
        enabled: true,
        error_code: null,
        gateway_running: true,
        id: 'telegram',
        state: 'connected'
      })
    ).toBe('connected')
  })
})
