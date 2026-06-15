import { LEASH_AGENT_STORAGE_KEY, LEASH_BANNER_NEVER_KEY, type LeashAgentConfig } from './types'

/** Device-local storage for Leash identity. Web uses localStorage; desktop mirrors to native app storage. */
export interface LeashIdentityStorage {
  clearAgent(): void
  getAgent(): LeashAgentConfig | null
  isBannerNeverShow(): boolean
  setAgent(config: LeashAgentConfig | null): void
  setBannerNeverShow(value: boolean): void
}

function readJson<T>(key: string): T | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null
    }

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
    if (typeof window === 'undefined' || !window.localStorage) {
      return
    }

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
      if (typeof window === 'undefined' || !window.localStorage) {
        return false
      }

      return window.localStorage.getItem(LEASH_BANNER_NEVER_KEY) === '1'
    } catch {
      return false
    }
  },
  setBannerNeverShow(value) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return
      }

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

function desktopLeashBridge() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.hermesDesktop?.leash
}

let desktopAgentCache = browserLeashStorage.getAgent()
let desktopBannerNeverCache = browserLeashStorage.isBannerNeverShow()
let desktopHydration: Promise<LeashAgentConfig | null> | null = null

export async function hydrateLeashStorageFromDesktop(): Promise<LeashAgentConfig | null> {
  const bridge = desktopLeashBridge()

  if (!bridge) {
    return browserLeashStorage.getAgent()
  }

  if (desktopHydration) {
    return desktopHydration
  }

  const fallbackAgent = desktopAgentCache
  const fallbackBannerNever = desktopBannerNeverCache

  desktopHydration = Promise.all([bridge.getAgent(), bridge.getBannerNeverShow()])
    .then(([agent, neverShow]) => {
      const nextAgent = agent ?? fallbackAgent
      const nextBannerNever = Boolean(neverShow || fallbackBannerNever)

      desktopAgentCache = nextAgent
      desktopBannerNeverCache = nextBannerNever

      browserLeashStorage.setAgent(nextAgent)
      browserLeashStorage.setBannerNeverShow(desktopBannerNeverCache)

      if (!agent && fallbackAgent) {
        void bridge.setAgent(fallbackAgent)
      }

      if (!neverShow && fallbackBannerNever) {
        void bridge.setBannerNeverShow(true)
      }

      return nextAgent
    })
    .finally(() => {
      desktopHydration = null
    })

  return desktopHydration
}

const desktopLeashStorage: LeashIdentityStorage = {
  getAgent() {
    return desktopAgentCache
  },
  setAgent(config) {
    desktopAgentCache = config
    browserLeashStorage.setAgent(config)
    void desktopLeashBridge()?.setAgent(config)
  },
  clearAgent() {
    desktopAgentCache = null
    browserLeashStorage.clearAgent()
    void desktopLeashBridge()?.clearAgent()
  },
  isBannerNeverShow() {
    return desktopBannerNeverCache
  },
  setBannerNeverShow(value) {
    desktopBannerNeverCache = value
    browserLeashStorage.setBannerNeverShow(value)
    void desktopLeashBridge()?.setBannerNeverShow(value)
  }
}

/** Active storage backend. Browser uses localStorage; desktop uses a native-backed mirror. */
let activeStorage: LeashIdentityStorage = desktopLeashBridge() ? desktopLeashStorage : browserLeashStorage

if (desktopLeashBridge()) {
  void hydrateLeashStorageFromDesktop()
}

export function getLeashStorage(): LeashIdentityStorage {
  return activeStorage
}

export function setLeashStorage(storage: LeashIdentityStorage) {
  activeStorage = storage
}
