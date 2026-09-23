import { atom, computed } from 'nanostores'

import { $gatewayState } from '@/store/session'

// ── Gateway link health (blip vs outage) ───────────────────────────────────
// `$gatewayState` is the raw socket state and flips to `closed` the instant
// the WebSocket drops. Rendering that directly meant every proxy hiccup,
// dashboard restart, or Wi-Fi blip disabled the composer and threw the
// "Reconnecting to Verxio" overlay over the whole app — even when the socket
// was back 1–2s later. This store adds hysteresis: once the link has been open,
// a drop is treated as a *blip* for RECONNECT_GRACE_MS. The composer stays
// enabled (sends wait for the socket via waitForGatewayOpen), nothing visible
// changes. Only when the drop outlives the grace window does the link become
// `degraded` and the reconnect UI is allowed to surface.

export const RECONNECT_GRACE_MS = 10_000

// Reconnect backoff: 1s, 2s, 4s, 8s, 15s cap, plus up to 30% jitter so a fleet
// of tabs (or a whole office) does not stampede the proxy in lock-step after a
// shared outage. Never gives up — the primary/secondary loops call this forever.
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_CAP_MS = 15_000
export const RECONNECT_JITTER = 0.3

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** Math.min(Math.max(0, attempt), 4))
  const jitter = base * RECONNECT_JITTER * Math.min(1, Math.max(0, random()))

  return Math.round(base + jitter)
}

export interface GatewayLink {
  // The socket has been open at least once this page load. Before that the
  // boot overlay owns the screen and there is nothing to "reconnect".
  everOpen: boolean
  // Down for longer than RECONNECT_GRACE_MS after having been open.
  degraded: boolean
  downSince: number | null
}

const initialLink: GatewayLink = { everOpen: false, degraded: false, downSince: null }

export const $gatewayLink = atom<GatewayLink>(initialLink)

// True while it is reasonable to let the user keep typing and sending: the
// socket is open, or it dropped moments ago and the reconnect loop is on it.
export const $gatewayReachable = computed([$gatewayState, $gatewayLink], (state, link) => {
  if (state === 'open') {
    return true
  }

  return link.everOpen && !link.degraded
})

let graceTimer: ReturnType<typeof setTimeout> | null = null
let now: () => number = Date.now

function clearGrace(): void {
  if (graceTimer !== null) {
    clearTimeout(graceTimer)
    graceTimer = null
  }
}

function onGatewayState(state: string): void {
  const link = $gatewayLink.get()

  if (state === 'open') {
    clearGrace()

    if (!link.everOpen || link.degraded || link.downSince !== null) {
      $gatewayLink.set({ everOpen: true, degraded: false, downSince: null })
    }

    return
  }

  if (!link.everOpen || link.downSince !== null) {
    // Still booting, or already inside a grace window — nothing to restart.
    return
  }

  $gatewayLink.set({ ...link, downSince: now() })
  clearGrace()

  graceTimer = setTimeout(() => {
    graceTimer = null
    const current = $gatewayLink.get()

    if ($gatewayState.get() !== 'open' && current.downSince !== null) {
      $gatewayLink.set({ ...current, degraded: true })
    }
  }, RECONNECT_GRACE_MS)
}

$gatewayState.subscribe(onGatewayState)

// Resolve true as soon as the socket is open (immediately if it already is),
// false once `timeoutMs` elapses. Lets a send issued during a blip wait for the
// reconnect instead of failing with "gateway is not connected".
export function waitForGatewayOpen(timeoutMs = RECONNECT_GRACE_MS): Promise<boolean> {
  if ($gatewayState.get() === 'open') {
    return Promise.resolve(true)
  }

  return new Promise(resolve => {
    let done = false
    let unsubscribe: () => void = () => {}

    const finish = (value: boolean) => {
      if (done) {
        return
      }

      done = true
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }

    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs))

    unsubscribe = $gatewayState.listen(state => {
      if (state === 'open') {
        finish(true)
      }
    })
  })
}

export function resetGatewayLinkForTests(clock: () => number = Date.now): void {
  clearGrace()
  now = clock
  $gatewayLink.set(initialLink)
}
