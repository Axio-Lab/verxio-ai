import { atom } from 'nanostores'

import type { VerxioRuntimeControlResponse, VerxioRuntimePhase } from '@/lib/verxio-api'

export interface RuntimePhaseState {
  detail: string | null
  phase: VerxioRuntimePhase | null
  /** Epoch ms of the last status probe that produced this phase. */
  updatedAt: number
}

const IDLE: RuntimePhaseState = { detail: null, phase: null, updatedAt: 0 }

/**
 * Spin-up progress while the local Hermes dashboard is not yet reachable.
 * Desktop maps `verxio:boot-progress` onto this store; the public/web path
 * still polls `GET /api/runtime`. Cleared once the gateway socket is open.
 */
export const $runtimePhase = atom<RuntimePhaseState>(IDLE)

// Relative order for the progress bar; "starting" (legacy planes) sits mid-way.
const PHASE_PROGRESS: Record<VerxioRuntimePhase, number> = {
  attaching_profile: 85,
  failed: 15,
  preparing_env: 65,
  queued: 15,
  ready: 100,
  restoring_home: 40,
  starting: 50,
  stopped: 0
}

export function runtimePhaseProgress(phase: VerxioRuntimePhase | null): number {
  return phase ? PHASE_PROGRESS[phase] : 0
}

export function applyRuntimeStatus(status: Pick<VerxioRuntimeControlResponse, 'connected' | 'phase' | 'phase_detail'>) {
  const phase: VerxioRuntimePhase | null = status.connected ? 'ready' : (status.phase ?? null)
  const current = $runtimePhase.get()

  if (current.phase === phase && (current.detail ?? null) === (status.phase_detail ?? null)) {
    return
  }

  $runtimePhase.set({ detail: status.phase_detail ?? null, phase, updatedAt: Date.now() })
}

export function resetRuntimePhase() {
  if ($runtimePhase.get().phase !== null) {
    $runtimePhase.set(IDLE)
  }
}
