import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ToolsetInfo } from '@/types/hermes'

import { PAGE_INSET_X } from '../layout-constants'
import { asText, toolsetDisplayLabel } from '../settings/helpers'
import { ToolsetConfigPanel } from '../settings/toolset-config-panel'

export const WEB_SEARCH_TOOLSET_NAME = 'web'

interface WebSearchToolsetPanelProps {
  className?: string
  onConfiguredChange?: () => void
  onToggle: (enabled: boolean) => void
  saving?: boolean
  toolset: ToolsetInfo | null
}

export function WebSearchToolsetPanel({
  className,
  onConfiguredChange,
  onToggle,
  saving = false,
  toolset
}: WebSearchToolsetPanelProps) {
  const { t } = useI18n()

  if (!toolset) {
    return null
  }

  const label = toolsetDisplayLabel(toolset)

  return (
    <section className={cn('border-b border-border pb-4', PAGE_INSET_X, className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{t.skills.webSearchTitle}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {asText(toolset.description) || t.skills.webSearchDescription}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
          <span className="text-xs text-muted-foreground">
            {toolset.configured ? t.skills.configured : t.skills.needsKeys}
          </span>
          <Switch
            aria-label={t.skills.toggleToolset(label)}
            checked={toolset.enabled}
            disabled={saving}
            onCheckedChange={onToggle}
          />
        </div>
      </div>
      <ToolsetConfigPanel onConfiguredChange={onConfiguredChange} toolset={WEB_SEARCH_TOOLSET_NAME} />
    </section>
  )
}
