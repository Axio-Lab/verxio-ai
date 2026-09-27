import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $gatewayLink,
  $gatewayReachable,
  RECONNECT_CAP_MS,
  RECONNECT_GRACE_MS,
  reconnectDelayMs,
  resetGatewayLinkForTests,
  waitForGatewayOpen
} from '@/store/gateway-link'
import { $gatewayState, setGatewayState } from '@/store/session'

describe('gateway link hysteresis', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setGatewayState('idle')
    resetGatewayLinkForTests(() => Date.now())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is unreachable before the first open (boot overlay owns the screen)', () => {
    expect($gatewayReachable.get()).toBe(false)
    setGatewayState('connecting')
    expect($gatewayReachable.get()).toBe(false)
    expect($gatewayLink.get().everOpen).toBe(false)
  })

  it('treats a short drop after open as a blip: still reachable, not degraded', () => {
    setGatewayState('open')
    expect($gatewayReachable.get()).toBe(true)

    setGatewayState('closed')
    expect($gatewayReachable.get()).toBe(true)
    expect($gatewayLink.get().degraded).toBe(false)

    vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1)
    expect($gatewayReachable.get()).toBe(true)

    // Socket comes back inside the window: nothing ever surfaced.
    setGatewayState('open')
    vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2)
    expect($gatewayLink.get()).toEqual({ everOpen: true, degraded: false, downSince: null })
    expect($gatewayReachable.get()).toBe(true)
  })

  it('degrades only after the grace window and recovers on open', () => {
    setGatewayState('open')
    setGatewayState('error')
    // Intermediate connecting/closed flaps must not restart the grace clock.
    setGatewayState('connecting')
    setGatewayState('closed')

    vi.advanceTimersByTime(RECONNECT_GRACE_MS)
    expect($gatewayLink.get().degraded).toBe(true)
    expect($gatewayReachable.get()).toBe(false)

    setGatewayState('open')
    expect($gatewayLink.get().degraded).toBe(false)
    expect($gatewayReachable.get()).toBe(true)
  })

  it('waitForGatewayOpen resolves when the socket reopens or times out', async () => {
    setGatewayState('open')
    await expect(waitForGatewayOpen(50)).resolves.toBe(true)

    setGatewayState('closed')
    const pending = waitForGatewayOpen(5_000)
    vi.advanceTimersByTime(1_000)
    setGatewayState('open')
    await expect(pending).resolves.toBe(true)

    setGatewayState('closed')
    const timedOut = waitForGatewayOpen(2_000)
    vi.advanceTimersByTime(2_000)
    await expect(timedOut).resolves.toBe(false)
    expect($gatewayState.get()).toBe('closed')
  })
})

describe('reconnectDelayMs', () => {
  it('backs off exponentially to the cap with bounded jitter and never stops', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(1_000)
    expect(reconnectDelayMs(1, () => 0)).toBe(2_000)
    expect(reconnectDelayMs(2, () => 0)).toBe(4_000)
    expect(reconnectDelayMs(3, () => 0)).toBe(8_000)
    expect(reconnectDelayMs(4, () => 0)).toBe(RECONNECT_CAP_MS)
    expect(reconnectDelayMs(50, () => 0)).toBe(RECONNECT_CAP_MS)
    expect(reconnectDelayMs(50, () => 1)).toBe(RECONNECT_CAP_MS * 1.3)
    expect(reconnectDelayMs(-3, () => 0.5)).toBe(1_150)
  })
})
