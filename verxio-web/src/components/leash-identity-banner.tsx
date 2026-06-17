import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { LEASH_BANNER_CLEARANCE_TOP, LEASH_BANNER_PADDING_X } from '@/app/layout-constants'
import { SETTINGS_ROUTE } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { X } from '@/lib/icons'
import { isLeashIdentityConfigured } from '@/lib/leash/identity'
import { cn } from '@/lib/utils'
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
      className={cn(
        'relative z-4 w-full shrink-0 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) py-2.5',
        LEASH_BANNER_CLEARANCE_TOP,
        LEASH_BANNER_PADDING_X
      )}
      role="status"
    >
      <Button
        aria-label={copy.dismiss}
        className="absolute top-2 right-2 z-1 text-muted-foreground sm:hidden"
        onClick={() => setDismissed(true)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <X className="size-3.5" />
      </Button>

      <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 w-full pr-7 sm:max-w-none sm:flex-1 sm:pr-0">
          <p className="text-sm font-medium leading-snug text-foreground sm:text-[length:var(--conversation-caption-font-size)]">
            {copy.title}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground sm:mt-0.5 sm:text-[length:var(--conversation-caption-font-size)] sm:leading-snug">
            {copy.body}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-stretch gap-2 sm:w-auto sm:items-center sm:justify-end">
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
            className="hidden shrink-0 text-muted-foreground sm:inline-flex"
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
