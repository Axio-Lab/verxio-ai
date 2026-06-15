import { useEffect, useMemo, useRef } from 'react'

import { useRoutePageParam } from './use-route-page-param'

export const DEFAULT_LIST_PAGE_SIZE = 10

export function usePaginatedList<T>(items: T[], pageSize = DEFAULT_LIST_PAGE_SIZE, resetKey?: string) {
  const [page, setPage] = useRoutePageParam()
  const prevResetKey = useRef(resetKey)

  useEffect(() => {
    if (resetKey !== undefined && prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey
      setPage(1)
    }
  }, [resetKey, setPage])

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize

  const visibleItems = useMemo(() => items.slice(pageStart, pageStart + pageSize), [items, pageStart, pageSize])

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount, setPage])

  return { currentPage, pageSize, setPage, total: items.length, visibleItems }
}
