import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/i18n'

import { SettingsContent } from './primitives'

export function AboutSettings() {
  const { t } = useI18n()
  const a = t.settings.about

  return (
    <SettingsContent>
      <div className="grid min-h-[min(28rem,70vh)] place-items-center px-6 py-10">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <BrandMark className="size-20" />
          <div className="grid gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{a.heading}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{a.description}</p>
          </div>
        </div>
      </div>
    </SettingsContent>
  )
}
