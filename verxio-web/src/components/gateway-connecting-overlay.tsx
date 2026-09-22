import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { getVerxioRuntime, verxioApiEnabled } from '@/lib/verxio-api'
import { $desktopBoot } from '@/store/boot'
import { $desktopOnboarding } from '@/store/onboarding'
import { $runtimePhase, applyRuntimeStatus, resetRuntimePhase, runtimePhaseProgress } from '@/store/runtime-phase'
import { $gatewayState } from '@/store/session'

// Static, always-legible prefix; only TAIL ever scrambles. Splitting them at
// the render level means no timer logic (even a stale HMR one) can ever
// scramble "CONN".
const PREFIX = 'CONN'
const TAIL = 'ECTING'
// Even-weight mono ascii so cycling glyphs don't jump width (matches the
// nousnet-web download-button decode effect).
const SCRAMBLE_CHARS = '/\\|-_=+<>~:*'
const TICK_MS = 45

// Exit choreography (ms): text fades down + out, hold, then the overlay fades.
const TEXT_OUT_MS = 360
const POST_TEXT_HOLD_MS = 300
const OVERLAY_OUT_MS = 520
// Preview-only: how long to "connect" for, and the pause before replaying.
const PREVIEW_CONNECT_MS = 2600
const PREVIEW_REPLAY_MS = 1100
// Hosted spin-up: how often to ask the control plane which step the worker is on.
const RUNTIME_PHASE_POLL_MS = 2500

type Phase = 'live' | 'text-out' | 'overlay-out' | 'gone'

// Dev affordance: a warm Cmd+R reconnects almost instantly, so the overlay
// only flashes. Load with `?connecting=1` to force a looping preview.
function forcedPreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false
  }

  try {
    return new URLSearchParams(window.location.search).get('connecting') === '1'
  } catch {
    return false
  }
}

function scrambledTail(resolvedCount: number): string {
  return Array.from(TAIL, (ch, i) =>
    i < resolvedCount ? ch : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0]
  ).join('')
}

export function GatewayConnectingOverlay() {
  const { t } = useI18n()
  const gatewayState = useStore($gatewayState)
  const boot = useStore($desktopBoot)
  const onboarding = useStore($desktopOnboarding)
  const runtimePhase = useStore($runtimePhase)
  const [previewing] = useState(forcedPreview)
  const [tail, setTail] = useState(TAIL)
  const [phase, setPhase] = useState<Phase>('live')

  const connecting = gatewayState !== 'open' && !boot.error
  // Settings → Providers launches manual OAuth on top of the app. Don't
  // flash the full-screen gateway reconnect overlay over that flow — it reads
  // like the sign-in failed and the user lands back on the provider page.
  const manualOAuthActive = onboarding.manual && onboarding.requested
  // Latches once we've actually shown the overlay, so the brief frame where
  // gatewayState flips to "open" (connecting -> false) before the exit phase
  // kicks in doesn't unmount us and cause a flash.
  const shownRef = useRef(false)

  if (previewing || connecting) {
    shownRef.current = true
  }

  // Hosted runtimes: poll GET /api/runtime while the socket is down so the
  // overlay can say "Restoring your workspace…" instead of a bare CONNECTING.
  // Same code path on web and desktop (both render this component).
  useEffect(() => {
    if (!connecting || previewing || !verxioApiEnabled()) {
      if (!connecting) {
        resetRuntimePhase()
      }

      return
    }

    let cancelled = false

    const probe = () => {
      getVerxioRuntime()
        .then(status => {
          if (!cancelled) {
            applyRuntimeStatus(status)
          }
        })
        .catch(() => {
          // Not signed in yet or API briefly unreachable — keep the last phase.
        })
    }

    probe()
    const id = window.setInterval(probe, RUNTIME_PHASE_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [connecting, previewing])

  // Decode loop — only while live (freeze the resolved word during the exit).
  useEffect(() => {
    if (phase !== 'live' || (!previewing && !connecting)) {
      return
    }

    let resolved = 0
    let hold = 0

    const id = window.setInterval(() => {
      if (resolved >= TAIL.length) {
        hold += 1

        if (hold > 16) {
          resolved = 0
          hold = 0
        }

        setTail(TAIL)

        return
      }

      resolved += 0.5
      setTail(scrambledTail(Math.floor(resolved)))
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [phase, previewing, connecting])

  // Kick off the exit when connected: real connect, or a faked timer in preview.
  useEffect(() => {
    if (phase !== 'live') {
      return
    }

    if (previewing) {
      const id = window.setTimeout(() => {
        setTail(TAIL)
        setPhase('text-out')
      }, PREVIEW_CONNECT_MS)

      return () => window.clearTimeout(id)
    }

    if (gatewayState === 'open' && shownRef.current) {
      setTail(TAIL)
      setPhase('text-out')
    }
  }, [phase, previewing, gatewayState])

  // Advance the exit choreography: text-out -> overlay-out -> gone.
  useEffect(() => {
    if (phase === 'text-out') {
      const id = window.setTimeout(() => setPhase('overlay-out'), TEXT_OUT_MS + POST_TEXT_HOLD_MS)

      return () => window.clearTimeout(id)
    }

    if (phase === 'overlay-out') {
      const id = window.setTimeout(() => setPhase('gone'), OVERLAY_OUT_MS)

      return () => window.clearTimeout(id)
    }

    // Preview replays so we can keep watching the transition.
    if (phase === 'gone' && previewing) {
      const id = window.setTimeout(() => {
        setTail(TAIL)
        setPhase('live')
      }, PREVIEW_REPLAY_MS)

      return () => window.clearTimeout(id)
    }
  }, [phase, previewing])

  // Boot failed — BootFailureOverlay owns the screen; don't linger behind it.
  if (boot.error && !previewing) {
    return null
  }

  if (manualOAuthActive && !previewing) {
    return null
  }

  // Real connect: once the fade finishes, get out of the way for good.
  if (phase === 'gone' && !previewing) {
    return null
  }

  // Never showed (e.g. gateway already up on a warm reload) — stay out.
  if (!previewing && !connecting && !shownRef.current) {
    return null
  }

  const leaving = phase !== 'live'
  const overlayHidden = phase === 'overlay-out' || phase === 'gone'
  // Hosted spin-up: the pool worker reports which step it is on. Hidden for
  // plain socket reconnects (phase null) so a warm reload stays minimal.
  const spinUp = runtimePhase.phase && runtimePhase.phase !== 'stopped' ? runtimePhase.phase : null
  const spinUpLabel = spinUp ? t.boot.runtimePhase[spinUp] : null
  const spinUpProgress = runtimePhaseProgress(spinUp)

  return (
    <div
      className={cn(
        'fixed inset-0 z-[1200] grid place-items-center bg-(--ui-chat-surface-background) transition-opacity duration-500 ease-out',
        overlayHidden ? 'pointer-events-none opacity-0' : 'opacity-100'
      )}
    >
      <style>{'@keyframes gco-cursor { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }'}</style>
      <div
        className={cn(
          'flex flex-col items-center gap-3 transition duration-300 ease-out',
          leaving ? 'translate-y-2 opacity-0 saturate-0' : 'translate-y-0 opacity-100 saturate-100'
        )}
      >
        <span className="inline-flex items-center pl-[0.4em] font-mono text-[0.64rem] font-semibold uppercase tracking-[0.4em] tabular-nums text-(--theme-primary)">
          {PREFIX}
          {tail}
          <span
            aria-hidden="true"
            className="dither ml-0.5 inline-block size-2 shrink-0 -translate-y-px rounded-[1px]"
            style={{ animation: 'gco-cursor 1s step-end infinite' }}
          />
        </span>
        {spinUpLabel ? (
          <div className="flex w-56 flex-col items-center gap-1.5" data-phase={spinUp} data-testid="runtime-spin-up">
            <div className="h-px w-full overflow-hidden bg-(--theme-primary)/15">
              <div
                className="h-full bg-(--theme-primary) transition-[width] duration-500 ease-out"
                style={{ width: `${spinUpProgress}%` }}
              />
            </div>
            <span
              className={cn(
                'font-mono text-[0.6rem] tracking-[0.12em] text-(--theme-primary)/70',
                spinUp === 'failed' && 'text-(--theme-danger,--theme-primary)'
              )}
            >
              {spinUpLabel}
            </span>
            {runtimePhase.detail ? (
              <span className="max-w-full truncate font-mono text-[0.55rem] tracking-[0.08em] text-(--theme-primary)/45">
                {runtimePhase.detail}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
