import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function useRoutePageParam(key = 'page'): [number, (next: number) => void] {
  const { hash, pathname, search } = useLocation()
  const navigate = useNavigate()

  const page = useMemo(() => {
    const raw = new URLSearchParams(search).get(key)
    const parsed = raw ? Number.parseInt(raw, 10) : 1

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  }, [key, search])

  const setPage = useCallback(
    (next: number) => {
      const normalized = Math.max(1, Math.floor(next))
      const params = new URLSearchParams(search)

      if (normalized <= 1) {
        params.delete(key)
      } else {
        params.set(key, String(normalized))
      }

      const qs = params.toString()
      navigate({ hash, pathname, search: qs ? `?${qs}` : '' }, { replace: true })
    },
    [hash, key, navigate, pathname, search]
  )

  return [page, setPage]
}
