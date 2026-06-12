import { atom, computed, type ReadableAtom } from 'nanostores'

import { isMobileViewport, MOBILE_OVERLAY_PANE_IDS } from '@/lib/responsive'

export interface PaneStateSnapshot {
  open: boolean
  widthOverride?: number
}

export interface PaneRegisterDefaults {
  open: boolean
  widthOverride?: number
}

const STORAGE_KEY = 'hermes.desktop.paneStates.v1'

function isSnapshot(value: unknown): value is PaneStateSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }

  const r = value as Record<string, unknown>

  if (typeof r.open !== 'boolean') {
    return false
  }

  return r.widthOverride === undefined || (typeof r.widthOverride === 'number' && Number.isFinite(r.widthOverride))
}

function load(): Record<string, PaneStateSnapshot> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (raw) {
      const parsed = JSON.parse(raw) as unknown

      if (parsed && typeof parsed === 'object') {
        const out: Record<string, PaneStateSnapshot> = {}

        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (isSnapshot(value)) {
            out[id] = { open: value.open, widthOverride: value.widthOverride }
          }
        }

        return out
      }
    }
  } catch {
    // Treat unparseable persisted state as missing.
  }

  return {}
}

// widthOverride is in-memory only — phase 2 can add per-pane persistWidth opt-in.
function persist(states: Record<string, PaneStateSnapshot>) {
  if (typeof window === 'undefined') {
    return
  }

  const minimal: Record<string, { open: boolean }> = {}

  for (const [id, s] of Object.entries(states)) {
    minimal[id] = { open: s.open }
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal))
  } catch {
    // Storage failures are nonfatal.
  }
}

export const $paneStates = atom<Record<string, PaneStateSnapshot>>(load())

$paneStates.subscribe(persist)

// Cached per-pane derived atoms keep useStore subscriptions referentially stable.
function memoized<T>(
  cache: Map<string, ReadableAtom<T>>,
  id: string,
  selector: (s: PaneStateSnapshot | undefined) => T
) {
  let cached = cache.get(id)

  if (!cached) {
    cached = computed($paneStates, states => selector(states[id]))
    cache.set(id, cached)
  }

  return cached
}

const openCache = new Map<string, ReadableAtom<boolean>>()
const stateCache = new Map<string, ReadableAtom<PaneStateSnapshot | undefined>>()
const widthCache = new Map<string, ReadableAtom<number | undefined>>()

export const $paneOpen = (id: string) => memoized(openCache, id, s => s?.open ?? false)
export const $paneState = (id: string) => memoized(stateCache, id, s => s)
export const $paneWidthOverride = (id: string) => memoized(widthCache, id, s => s?.widthOverride)

export function ensurePaneRegistered(id: string, defaults: PaneRegisterDefaults) {
  const current = $paneStates.get()

  if (current[id] !== undefined) {
    return
  }

  $paneStates.set({ ...current, [id]: { open: defaults.open, widthOverride: defaults.widthOverride } })
}

function closeOtherMobileOverlayPanes(exceptId: string, current: Record<string, PaneStateSnapshot>) {
  if (!isMobileViewport()) {
    return current
  }

  if (!MOBILE_OVERLAY_PANE_IDS.includes(exceptId as (typeof MOBILE_OVERLAY_PANE_IDS)[number])) {
    return current
  }

  let next = current

  for (const paneId of MOBILE_OVERLAY_PANE_IDS) {
    if (paneId === exceptId || !current[paneId]?.open) {
      continue
    }

    next = { ...next, [paneId]: { ...current[paneId]!, open: false } }
  }

  return next
}

export function setPaneOpen(id: string, open: boolean) {
  const current = $paneStates.get()
  const existing = current[id]

  if (existing?.open === open) {
    return
  }

  let next = { ...current, [id]: { open, widthOverride: existing?.widthOverride } }

  if (open) {
    next = closeOtherMobileOverlayPanes(id, next)
  }

  $paneStates.set(next)
}

export function togglePane(id: string) {
  const current = $paneStates.get()
  const existing = current[id]
  const open = !(existing?.open ?? false)

  let next = { ...current, [id]: { open, widthOverride: existing?.widthOverride } }

  if (open) {
    next = closeOtherMobileOverlayPanes(id, next)
  }

  $paneStates.set(next)
}

export function setPaneWidthOverride(id: string, width: number | undefined) {
  const current = $paneStates.get()
  const existing = current[id] ?? { open: false }

  if (existing.widthOverride === width) {
    return
  }

  $paneStates.set({ ...current, [id]: { open: existing.open, widthOverride: width } })
}

export const clearPaneWidthOverride = (id: string) => setPaneWidthOverride(id, undefined)
export const getPaneStateSnapshot = (id: string) => $paneStates.get()[id]
