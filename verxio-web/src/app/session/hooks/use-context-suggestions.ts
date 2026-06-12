import { type MutableRefObject, useCallback, useEffect } from 'react'

import { completeWebLocalPath } from '@/lib/web-local-completions'
import { resolveWebLocalWorkspaceCwd } from '@/lib/web-local-fs'
import { $currentCwd, setContextSuggestions } from '@/store/session'

import type { ContextSuggestion } from '../../types'

interface ContextSuggestionsOptions {
  activeSessionId: string | null
  activeSessionIdRef: MutableRefObject<string | null>
  currentCwd: string
  gatewayState: string | undefined
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function useContextSuggestions({
  activeSessionId,
  activeSessionIdRef,
  currentCwd,
  gatewayState,
  requestGateway
}: ContextSuggestionsOptions) {
  const refresh = useCallback(async () => {
    if (!activeSessionId) {
      setContextSuggestions([])

      return
    }

    const sessionId = activeSessionId
    const cwd = currentCwd || ''

    // Race guard: only commit if the session+cwd we sent for still match
    // by the time the gateway responds.
    const stillCurrent = () => activeSessionIdRef.current === sessionId && $currentCwd.get() === cwd

    try {
      let items: ContextSuggestion[] = []
      const webLocalCwd = resolveWebLocalWorkspaceCwd(cwd)

      if (webLocalCwd) {
        const localItems = await completeWebLocalPath('@file:', webLocalCwd)
        items = localItems
          .filter(item => item.text)
          .map(item => ({
            text: item.text,
            display: typeof item.display === 'string' ? item.display : item.text,
            meta: typeof item.meta === 'string' ? item.meta : undefined
          }))
      } else {
        const result = await requestGateway<{ items?: ContextSuggestion[] }>('complete.path', {
          session_id: sessionId,
          word: '@file:',
          cwd: cwd || undefined
        })

        items = (result.items || []).filter(i => i.text)
      }

      if (stillCurrent()) {
        setContextSuggestions(items)
      }
    } catch {
      if (stillCurrent()) {
        setContextSuggestions([])
      }
    }
  }, [activeSessionId, activeSessionIdRef, currentCwd, requestGateway])

  useEffect(() => {
    if (gatewayState === 'open' && activeSessionId) {
      void refresh()
    }
  }, [activeSessionId, gatewayState, refresh])
}
