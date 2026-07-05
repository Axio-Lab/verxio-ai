import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Read/write a free-form URL search param (e.g. ?paccount=openai-codex).
// Navigates with replace so detail views don't pile up in history.
export function useRouteStringParam(key: string): [null | string, (next: null | string) => void] {
  const { hash, pathname, search } = useLocation()
  const navigate = useNavigate()

  const value = useMemo(() => new URLSearchParams(search).get(key), [key, search])

  const setValue = useCallback(
    (next: null | string) => {
      const params = new URLSearchParams(search)

      if (next) {
        params.set(key, next)
      } else {
        params.delete(key)
      }

      const qs = params.toString()
      navigate({ hash, pathname, search: qs ? `?${qs}` : '' }, { replace: true })
    },
    [hash, key, navigate, pathname, search]
  )

  return [value, setValue]
}
