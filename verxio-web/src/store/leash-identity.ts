import { atom } from 'nanostores'

import {
  getLeashAgent,
  isLeashBannerNeverShow,
  isLeashIdentityConfigured,
  leashIdentityPhase,
  setLeashAgent,
  setLeashBannerNeverShow
} from '@/lib/leash/identity'
import type { LeashAgentConfig } from '@/lib/leash/types'

export const $leashAgent = atom<LeashAgentConfig | null>(getLeashAgent())
export const $leashConfigured = atom(isLeashIdentityConfigured())
export const $leashBannerNever = atom(isLeashBannerNeverShow())
export const $leashPhase = atom(leashIdentityPhase())

export function refreshLeashIdentityState() {
  const agent = getLeashAgent()

  $leashAgent.set(agent)
  $leashConfigured.set(isLeashIdentityConfigured(agent))
  $leashBannerNever.set(isLeashBannerNeverShow())
  $leashPhase.set(leashIdentityPhase(agent))
}

export function persistLeashAgent(config: LeashAgentConfig | null) {
  setLeashAgent(config)
  refreshLeashIdentityState()
}

export function suppressLeashBannerForever() {
  setLeashBannerNeverShow(true)
  $leashBannerNever.set(true)
}
