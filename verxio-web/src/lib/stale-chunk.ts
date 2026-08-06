/**
 * After a web redeploy, open tabs keep the old JS shell and try to lazy-load
 * hashed Vite chunks that no longer exist (404). Detect that and reload once
 * so the browser picks up the new index.html + asset map.
 */

const RELOAD_KEY = 'verxio:stale-chunk-reload'

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')

  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message)
  )
}

/** Reload at most once per tab session to avoid a hard refresh loop. */
export function reloadOnceForStaleChunk(error?: unknown): boolean {
  if (error !== undefined && !isStaleChunkError(error)) {
    return false
  }

  try {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') {
      return false
    }

    sessionStorage.setItem(RELOAD_KEY, '1')
  } catch {
    // Private mode / blocked storage — still attempt a single reload.
  }

  window.location.reload()

  return true
}

/** Clear the guard after a successful boot so a later deploy can reload again. */
export function clearStaleChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    // ignore
  }
}

export function installStaleChunkReload(): () => void {
  const onVitePreloadError = (event: Event) => {
    event.preventDefault()
    reloadOnceForStaleChunk()
  }

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (reloadOnceForStaleChunk(event.reason)) {
      event.preventDefault()
    }
  }

  window.addEventListener('vite:preloadError', onVitePreloadError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  // Successful load of this module means the current shell is good enough to
  // allow a future deploy-triggered reload.
  clearStaleChunkReloadGuard()

  return () => {
    window.removeEventListener('vite:preloadError', onVitePreloadError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}
