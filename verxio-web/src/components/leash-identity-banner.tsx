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
    <div
      className="relative z-4 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) px-3 py-3 sm:px-4"
      role="status"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 pr-8 sm:pr-0">
          <p className="text-[length:var(--conversation-caption-font-size)] font-medium leading-snug text-foreground">
            {copy.title}
          </p>
          <p className="mt-0.5 text-[length:var(--conversation-caption-font-size)] leading-snug text-muted-foreground">
            {copy.body}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          <Button
            className="min-w-0 flex-1 sm:flex-none"
            onClick={() => navigate(`${SETTINGS_ROUTE}?tab=mcp&server=leash`)}
            size="sm"
            type="button"
            variant="default"
          >
            {copy.setup}
          </Button>
          <Button
            className="min-w-0 flex-1 sm:flex-none"
            onClick={() => suppressLeashBannerForever()}
            size="sm"
            type="button"
            variant="text"
          >
            {copy.never}
          </Button>
          <Button
            aria-label={copy.dismiss}
            className="absolute right-2 top-2 text-muted-foreground sm:static sm:shrink-0"
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
