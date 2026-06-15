import { describe, expect, it } from 'vitest'

import { buildLeashAgentDraft, isLeashIdentityConfigured, leashIdentityPhase, parseLeashAgentJson } from './identity'
import { setLeashStorage } from './storage'
import type { LeashIdentityStorage } from './storage'

function memoryStorage(): LeashIdentityStorage {
  const agent = { current: null as ReturnType<LeashIdentityStorage['getAgent']> }
  let never = false

  return {
    getAgent: () => agent.current,
    setAgent: value => {
      agent.current = value
    },
    clearAgent: () => {
      agent.current = null
    },
    isBannerNeverShow: () => never,
    setBannerNeverShow: value => {
      never = value
    }
  }
}

describe('leash identity', () => {
  it('treats only agent_mint as configured', () => {
    expect(isLeashIdentityConfigured(null)).toBe(false)
    expect(isLeashIdentityConfigured({ executive_keypair: 'abc' })).toBe(false)
    expect(
      isLeashIdentityConfigured({
        pending_register: { executive_keypair: 'abc' },
        executive_keypair: 'abc'
      })
    ).toBe(false)
    expect(isLeashIdentityConfigured({ agent_mint: 'Agnt123' })).toBe(true)
  })

  it('classifies pending funding separately from registered', () => {
    const storage = memoryStorage()
    setLeashStorage(storage)

    storage.setAgent(buildLeashAgentDraft({ executiveKeypair: 'abc', network: 'solana-devnet' }))
    expect(leashIdentityPhase()).toBe('pending_funding')
    expect(isLeashIdentityConfigured()).toBe(false)

    storage.setAgent({ agent_mint: 'Agnt123', executive_keypair: 'abc' })
    expect(leashIdentityPhase()).toBe('registered')
    expect(isLeashIdentityConfigured()).toBe(true)
  })

  it('parses exported agent json', () => {
    const parsed = parseLeashAgentJson('{"version":1,"agent_mint":"Agnt123"}')
    expect(parsed.agent_mint).toBe('Agnt123')
  })
})
