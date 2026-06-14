export const LEASH_MCP_SERVER_NAME = 'leash'

export const LEASH_AGENT_STORAGE_KEY = 'verxio.leash.agent.v1'
export const LEASH_BANNER_NEVER_KEY = 'verxio.leash.banner.never.v1'

export type LeashNetwork = 'solana-devnet' | 'solana-mainnet'

export interface LeashServiceEntry {
  endpoint: string
  name: string
}

export interface LeashPendingRegister {
  executive_keypair?: string
  meta?: {
    description?: string
    image_url?: string
    name?: string
    services?: LeashServiceEntry[]
  }
}

/** Mirrors ~/.config/leash/agent.json — canonical copy lives on the user device (localStorage). */
export interface LeashAgentConfig {
  agent_mint?: string
  executive_keypair?: string
  network?: LeashNetwork | string
  pending_register?: LeashPendingRegister
  rpc_url?: string
  treasury_address?: string
  version?: number
}

export type LeashIdentityPhase = 'none' | 'pending_funding' | 'registered'
