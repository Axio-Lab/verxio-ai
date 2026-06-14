import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { getLeashAgent } from '@/lib/leash/identity'
import { hydrateLeashIdentity } from '@/lib/leash/sync'
import { verxioApiEnabled } from '@/lib/verxio-api'
import { refreshLeashIdentityState } from '@/store/leash-identity'
import { $connection } from '@/store/session'

/** Push device-local Leash identity into the runtime when the dashboard connects. */
export function useLeashHydration() {
  const connection = useStore($connection)

  useEffect(() => {
    refreshLeashIdentityState()

    if (!connection || !verxioApiEnabled()) {
      return
    }

    const agent = getLeashAgent()

    if (!agent) {
      return
    }

    void hydrateLeashIdentity(agent).catch(() => {
      // Hydration is best-effort on connect; the MCP settings panel retries explicitly.
    })
  }, [connection])
}
