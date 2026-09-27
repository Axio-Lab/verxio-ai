import { useEffect } from 'react'

import {
  getDesktopWorkspaceRoot,
  isVerxioDesktop,
  resolveDesktopWorkspaceCwd,
  setDesktopWorkspaceRoot
} from '@/lib/desktop-workspace'
import { $currentCwd, setCurrentCwd } from '@/store/session'

/** Ensure a local workspace folder exists and keep UI cwd off Docker /workspace paths. */
export function useDesktopWorkspace() {
  useEffect(() => {
    if (!isVerxioDesktop() || !window.hermesDesktop?.workspace?.ensure) {
      return
    }

    let cancelled = false

    void window.hermesDesktop.workspace.ensure().then(result => {
      if (cancelled || !result.dir) {
        return
      }

      setDesktopWorkspaceRoot(result.dir)

      const current = $currentCwd.get().trim()
      const resolved = resolveDesktopWorkspaceCwd(current || null, result.dir) ?? result.dir

      if (resolved !== current) {
        setCurrentCwd(resolved)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])
}

export function getResolvedDesktopWorkspaceCwd(currentCwd?: string | null): string | null {
  return resolveDesktopWorkspaceCwd(currentCwd, getDesktopWorkspaceRoot())
}
