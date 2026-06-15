import { getHermesConfigRecord, saveHermesConfig } from '@/hermes'
import type { HermesConfigRecord } from '@/types/hermes'

import { verxioApiEnabled, verxioFetch } from '../verxio-api'

import type { LeashAgentConfig, LeashNetwork } from './types'
import { LEASH_MCP_SERVER_NAME } from './types'

export function buildLeashMcpServerEntry(network: LeashNetwork) {
  return {
    command: 'npx',
    args: ['-y', '@leashmarket/mcp'],
    env: {
      LEASH_NETWORK: network
    },
    enabled: true
  }
}

export async function syncLeashAgentToRuntime(agent: LeashAgentConfig): Promise<void> {
  if (!verxioApiEnabled()) {
    return
  }

  await verxioFetch('/api/leash/agent-config', {
    body: JSON.stringify(agent),
    method: 'PUT'
  })
}

export async function pullLeashAgentFromRuntime(): Promise<LeashAgentConfig | null> {
  if (!verxioApiEnabled()) {
    return null
  }

  try {
    const response = await verxioFetch<{ config: LeashAgentConfig; ok: boolean }>('/api/leash/agent-config')

    return response.config ?? null
  } catch {
    return null
  }
}

export async function clearLeashAgentOnRuntime(): Promise<void> {
  if (!verxioApiEnabled()) {
    return
  }

  await verxioFetch('/api/leash/agent-config', { method: 'DELETE' })
}

export async function ensureLeashMcpServerEnabled(network: LeashNetwork): Promise<void> {
  const config = await getHermesConfigRecord()

  const servers =
    config.mcp_servers && typeof config.mcp_servers === 'object' && !Array.isArray(config.mcp_servers)
      ? { ...(config.mcp_servers as Record<string, unknown>) }
      : {}

  servers[LEASH_MCP_SERVER_NAME] = buildLeashMcpServerEntry(network)

  const next: HermesConfigRecord = { ...config, mcp_servers: servers }
  await saveHermesConfig(next)
}

export async function disableLeashMcpServer(): Promise<void> {
  const config = await getHermesConfigRecord()
  const raw = config.mcp_servers

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return
  }

  const servers = { ...(raw as Record<string, unknown>) }
  delete servers[LEASH_MCP_SERVER_NAME]

  const next: HermesConfigRecord = { ...config, mcp_servers: servers }
  await saveHermesConfig(next)
}

export async function hydrateLeashIdentity(agent: LeashAgentConfig | null): Promise<void> {
  if (!agent) {
    await clearLeashAgentOnRuntime()

    return
  }

  await syncLeashAgentToRuntime(agent)
  await ensureLeashMcpServerEnabled(agent.network === 'solana-mainnet' ? 'solana-mainnet' : 'solana-devnet')
}
