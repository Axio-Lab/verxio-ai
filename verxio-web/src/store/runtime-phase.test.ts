import { beforeEach, describe, expect, it } from 'vitest'

import { $runtimePhase, applyRuntimeStatus, resetRuntimePhase, runtimePhaseProgress } from './runtime-phase'

describe('runtime phase store', () => {
  beforeEach(() => {
    resetRuntimePhase()
  })

  it('mirrors the pool worker phase while the dashboard is unreachable', () => {
    applyRuntimeStatus({ connected: false, phase: 'queued', phase_detail: null })
    expect($runtimePhase.get().phase).toBe('queued')

    applyRuntimeStatus({ connected: false, phase: 'restoring_home', phase_detail: null })
    expect($runtimePhase.get().phase).toBe('restoring_home')
    expect(runtimePhaseProgress('restoring_home')).toBeGreaterThan(runtimePhaseProgress('queued'))
    expect(runtimePhaseProgress('attaching_profile')).toBeGreaterThan(runtimePhaseProgress('preparing_env'))
  })

  it('connected always reads as ready regardless of a stale phase', () => {
    applyRuntimeStatus({ connected: true, phase: 'attaching_profile', phase_detail: null })
    expect($runtimePhase.get().phase).toBe('ready')
    expect(runtimePhaseProgress('ready')).toBe(100)
  })

  it('keeps the failure detail and does not churn on identical probes', () => {
    applyRuntimeStatus({ connected: false, phase: 'failed', phase_detail: 'home restore: boom' })
    const first = $runtimePhase.get()
    applyRuntimeStatus({ connected: false, phase: 'failed', phase_detail: 'home restore: boom' })
    expect($runtimePhase.get()).toBe(first)
    expect(first.detail).toBe('home restore: boom')
  })

  it('resets to idle so a later reconnect starts blank', () => {
    applyRuntimeStatus({ connected: false, phase: 'starting', phase_detail: null })
    resetRuntimePhase()
    expect($runtimePhase.get().phase).toBeNull()
  })
})
