import { useEffect, useRef } from 'react'

import { useIsMobile } from '@/hooks/use-mobile'
import { PREVIEW_PANE_ID } from '@/lib/responsive'
import { setFileBrowserOpen, setSidebarOpen } from '@/store/layout'
import { setPaneOpen } from '@/store/panes'

function collapsePanesForMobile() {
  setSidebarOpen(false)
  setFileBrowserOpen(false)
  setPaneOpen(PREVIEW_PANE_ID, false)
}

/** Collapse side panes on small screens; they open as overlays when toggled. */
export function useResponsivePanes() {
  const isMobile = useIsMobile()
  const wasMobileRef = useRef(isMobile)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true

      if (isMobile) {
        collapsePanesForMobile()
      }

      wasMobileRef.current = isMobile

      return
    }

    if (isMobile && !wasMobileRef.current) {
      collapsePanesForMobile()
    }

    wasMobileRef.current = isMobile
  }, [isMobile])
}
