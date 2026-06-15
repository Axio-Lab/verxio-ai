import { getLeashStorage } from './storage'
import type { LeashAgentConfig, LeashIdentityPhase, LeashNetwork } from './types'

export function getLeashAgent(): LeashAgentConfig | null {
  return getLeashStorage().getAgent()
}

export function setLeashAgent(config: LeashAgentConfig | null) {
  if (config) {
    getLeashStorage().setAgent(config)
  } else {
    getLeashStorage().clearAgent()
  }
}

export function clearLeashAgent() {
  getLeashStorage().clearAgent()
}

/** Registered on-chain only — keypair-only and funding_required stay unconfigured for the banner. */
export function isLeashIdentityConfigured(agent: LeashAgentConfig | null = getLeashAgent()): boolean {
  return Boolean(typeof agent?.agent_mint === 'string' && agent.agent_mint.trim().length > 0)
}

export function leashIdentityPhase(agent: LeashAgentConfig | null = getLeashAgent()): LeashIdentityPhase {
  if (!agent) {
    return 'none'
  }

  if (isLeashIdentityConfigured(agent)) {
    return 'registered'
  }

  if (agent.pending_register?.executive_keypair || agent.executive_keypair) {
    return 'pending_funding'
  }

  return 'none'
}

export function isLeashBannerNeverShow(): boolean {
  return getLeashStorage().isBannerNeverShow()
}

export function setLeashBannerNeverShow(value = true) {
  getLeashStorage().setBannerNeverShow(value)
}

export function buildLeashAgentDraft(input: {
  executiveKeypair: string
  network: LeashNetwork
  rpcUrl?: string
}): LeashAgentConfig {
  return {
    version: 1,
    network: input.network,
    rpc_url: input.rpcUrl?.trim() || undefined,
    executive_keypair: input.executiveKeypair,
    pending_register: {
      executive_keypair: input.executiveKeypair
    }
  }
}

export function mergeLeashAgentFromRuntime(remote: LeashAgentConfig): LeashAgentConfig {
  const local = getLeashAgent() ?? {}

  return {
    ...local,
    ...remote,
    pending_register: remote.pending_register ?? local.pending_register
  }
}

export function exportLeashAgentJson(agent: LeashAgentConfig = getLeashAgent() ?? {}): string {
  return `${JSON.stringify(agent, null, 2)}\n`
}

export function parseLeashAgentJson(raw: string): LeashAgentConfig {
  const parsed = JSON.parse(raw) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Leash export must be a JSON object.')
  }

  return parsed as LeashAgentConfig
}
