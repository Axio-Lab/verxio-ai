import { LEASH_AGENT_STORAGE_KEY, LEASH_BANNER_NEVER_KEY, type LeashAgentConfig } from './types'

/** Device-local storage for Leash identity. Web uses localStorage; desktop can swap to secure FS later. */
export interface LeashIdentityStorage {
  clearAgent(): void
  getAgent(): LeashAgentConfig | null
  isBannerNeverShow(): boolean
  setAgent(config: LeashAgentConfig | null): void
  setBannerNeverShow(value: boolean): void
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)

    if (!raw) {
      return null
    }

    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown | null) {
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    // Storage is best-effort in restricted contexts.
  }
}

export const browserLeashStorage: LeashIdentityStorage = {
  getAgent() {
    const parsed = readJson<LeashAgentConfig>(LEASH_AGENT_STORAGE_KEY)

    return parsed && typeof parsed === 'object' ? parsed : null
  },
  setAgent(config) {
    writeJson(LEASH_AGENT_STORAGE_KEY, config)
  },
  clearAgent() {
    writeJson(LEASH_AGENT_STORAGE_KEY, null)
  },
  isBannerNeverShow() {
    try {
      return window.localStorage.getItem(LEASH_BANNER_NEVER_KEY) === '1'
    } catch {
      return false
    }
  },
  setBannerNeverShow(value) {
    try {
      if (value) {
        window.localStorage.setItem(LEASH_BANNER_NEVER_KEY, '1')
      } else {
        window.localStorage.removeItem(LEASH_BANNER_NEVER_KEY)
      }
    } catch {
      // ignore
    }
  }
}

/** Active storage backend — replace for Verxio desktop (e.g. OS keychain + local file). */
let activeStorage: LeashIdentityStorage = browserLeashStorage

export function getLeashStorage(): LeashIdentityStorage {
  return activeStorage
}

export function setLeashStorage(storage: LeashIdentityStorage) {
  activeStorage = storage
}
