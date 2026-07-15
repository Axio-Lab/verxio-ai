import { useEffect, useMemo, useState } from 'react'

import { PaginationControl } from '@/components/ui/pagination'
import { useI18n } from '@/i18n'
import { CLOUD_TRANSCRIPTION_ENV_KEYS } from '@/lib/transcription-providers'
import type { EnvVarInfo } from '@/types/hermes'

import { DEFAULT_LIST_PAGE_SIZE, usePaginatedList } from '../hooks/use-paginated-list'

import { CredentialKeyCard, credentialPlaceholder, credentialRowLabel } from './credential-key-ui'
import { CustomToolKeyForm } from './custom-tool-key-form'
import { useEnvCredentials } from './env-credentials'
import { asText } from './helpers'
import { LoadingState, SettingsContent } from './primitives'
import { TranscriptionKeySettings } from './transcription-key-settings'

// Sub-views surfaced as sidebar subnav under Tools & Keys (see settings/index.tsx).
export const KEYS_VIEWS = ['tools', 'transcription', 'settings'] as const

export type KeysView = (typeof KEYS_VIEWS)[number]

// Providers live on their own page; messaging-platform credentials live on the
// dedicated Messaging page (and are hidden here via `channel_managed`). This
// view covers tool API keys plus server/setting env vars (API server, webhook,
// gateway), which fold into the Settings subnav.

// Backend categories that surface under each subnav. Platform credentials use the
// `messaging` category but are flagged ``channel_managed`` and configured on
// the Messaging page; only gateway-wide ``messaging`` rows (e.g. GATEWAY_PROXY)
// appear here alongside ``setting``.
const VIEW_CATEGORIES: Record<KeysView, readonly string[]> = {
  transcription: [],
  settings: ['setting', 'messaging'],
  tools: ['tool', 'skill']
}

export function KeysSettings({ view }: KeysSettingsProps) {
  const { t } = useI18n()
  const { confirmDialog, rowProps, saveValue, vars } = useEnvCredentials()
  const [openKey, setOpenKey] = useState<null | string>(null)

  useEffect(() => {
    setOpenKey(null)
  }, [view])

  const groups = useMemo(() => {
    if (!vars) {
      return []
    }

    return KEYS_VIEWS.flatMap(v => {
      const cats = VIEW_CATEGORIES[v]

      const entries = Object.entries(vars)
        .filter(
          ([key, info]) =>
            !info.channel_managed && cats.includes(asText(info.category)) && !CLOUD_TRANSCRIPTION_ENV_KEYS.includes(key)
        )
        .sort(([a], [b]) => a.localeCompare(b))

      return entries.length === 0 ? [] : [{ category: v, entries }]
    })
  }, [vars])

  const visibleEntries = useMemo(() => {
    const group = groups.find(g => g.category === view)

    return group?.entries ?? []
  }, [groups, view])

  const {
    currentPage,
    setPage,
    total,
    visibleItems: pagedEntries
  } = usePaginatedList(visibleEntries, DEFAULT_LIST_PAGE_SIZE, view)

  useEffect(() => {
    setOpenKey(null)
  }, [view])

  if (!vars) {
    return <LoadingState label={t.settings.keys.loading} />
  }

  const existingKeys = new Set(Object.keys(vars))
  const showCustomForm = view === 'tools'

  if (view === 'transcription') {
    return (
      <>
        <SettingsContent>
          <TranscriptionKeySettings rowProps={rowProps} vars={vars} />
        </SettingsContent>
        {confirmDialog}
      </>
    )
  }

  return (
    <>
      <SettingsContent>
        {showCustomForm && (
          <div className="mb-4">
            <CustomToolKeyForm busy={Boolean(rowProps.saving)} existingKeys={existingKeys} onSave={saveValue} />
          </div>
        )}
        {pagedEntries.length > 0 ? (
          <div className="grid gap-2">
            {pagedEntries.map(([key, info]: [string, EnvVarInfo]) => {
              const label = credentialRowLabel(key, info)

              return (
                <CredentialKeyCard
                  expanded={openKey === key}
                  info={info}
                  key={key}
                  label={label}
                  onExpand={() => setOpenKey(key)}
                  onToggle={() => setOpenKey(prev => (prev === key ? null : key))}
                  placeholder={credentialPlaceholder(key, info, label)}
                  rowProps={rowProps}
                  varKey={key}
                />
              )
            })}
            <PaginationControl
              className="pt-2"
              itemLabel="keys"
              onPageChange={setPage}
              page={currentPage}
              pageSize={DEFAULT_LIST_PAGE_SIZE}
              total={total}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-(--ui-stroke-tertiary) px-4 py-8 text-center text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
            {t.settings.keys.empty}
          </div>
        )}
      </SettingsContent>
      {confirmDialog}
    </>
  )
}

interface KeysSettingsProps {
  view: KeysView
}
