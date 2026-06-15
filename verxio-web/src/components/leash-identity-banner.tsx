import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { SETTINGS_ROUTE } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { X } from '@/lib/icons'
import { isLeashIdentityConfigured } from '@/lib/leash/identity'
import { verxioApiEnabled } from '@/lib/verxio-api'
import { $leashBannerNever, $leashConfigured, suppressLeashBannerForever } from '@/store/leash-identity'

export function LeashIdentityBanner() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const configured = useStore($leashConfigured)
  const neverShow = useStore($leashBannerNever)
  const [dismissed, setDismissed] = useState(false)

  if (!verxioApiEnabled() || configured || neverShow || dismissed || isLeashIdentityConfigured()) {
    return null
  }

  const copy = t.leash.banner

  return (
    <div className="relative z-4 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) px-4 py-2.5" role="status">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-[length:var(--conversation-caption-font-size)] leading-snug text-foreground">
          <p className="font-medium">{copy.title}</p>
          <p className="text-muted-foreground">{copy.body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            onClick={() => navigate(`${SETTINGS_ROUTE}?tab=mcp&server=leash`)}
            size="sm"
            type="button"
            variant="default"
          >
            {copy.setup}
          </Button>
          <Button onClick={() => suppressLeashBannerForever()} size="sm" type="button" variant="text">
            {copy.never}
          </Button>
          <Button
            aria-label={copy.dismiss}
            className="text-muted-foreground"
            onClick={() => setDismissed(true)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
