import { IconDownload, IconRefresh, IconUpload } from '@tabler/icons-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tip } from '@/components/ui/tooltip'
import { getHermesConfigDefaults, getHermesConfigRecord, saveHermesConfig } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Archive, Bell, Info, KeyRound, Mic, Settings2, Sparkles, Wrench, Zap } from '@/lib/icons'
import { notifyError } from '@/store/notifications'

import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { OverlayIconButton } from '../overlays/overlay-chrome'
import { OverlayMain, OverlayNavItem, OverlaySidebar, OverlaySplitLayout } from '../overlays/overlay-split-layout'
import { OverlayView } from '../overlays/overlay-view'

import { AppearanceSettings } from './appearance-settings'
import { SECTIONS } from './constants'
import { KEYS_VIEWS, type KeysView, PROVIDER_VIEWS, type ProviderView } from './nav-views'
import { LoadingState } from './primitives'
import type { SettingsPageProps, SettingsView as SettingsViewId } from './types'

const AboutSettings = lazy(async () => ({ default: (await import('./about-settings')).AboutSettings }))
const ConfigSettings = lazy(async () => ({ default: (await import('./config-settings')).ConfigSettings }))
const KeysSettings = lazy(async () => ({ default: (await import('./keys-settings')).KeysSettings }))
const McpSettings = lazy(async () => ({ default: (await import('./mcp-settings')).McpSettings }))
const NotificationsSettings = lazy(async () => ({
  default: (await import('./notifications-settings')).NotificationsSettings
}))
const ProvidersSettings = lazy(async () => ({ default: (await import('./providers-settings')).ProvidersSettings }))
const SessionsSettings = lazy(async () => ({ default: (await import('./sessions-settings')).SessionsSettings }))

const SETTINGS_VIEWS: readonly SettingsViewId[] = [
  ...SECTIONS.map(s => `config:${s.id}` as SettingsViewId),
  'providers',
  'keys',
  'mcp',
  'notifications',
  'sessions',
  'about'
]

export function SettingsView({ gateway, onClose, onConfigSaved, requestGateway }: SettingsPageProps) {
  const { t } = useI18n()
  const { hash, pathname, search } = useLocation()
  const navigate = useNavigate()
  const [activeView, setActiveView] = useRouteEnumParam('tab', SETTINGS_VIEWS, 'config:model' as SettingsViewId)
  // Providers subnav (Accounts vs API keys) lives in its own param so each
  // sub-view is deep-linkable and survives a refresh.
  const [providerView, setProviderView] = useRouteEnumParam<ProviderView>('pview', PROVIDER_VIEWS, 'accounts')
  const [keysView, setKeysView] = useRouteEnumParam<KeysView>('kview', KEYS_VIEWS, 'tools')
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(search)
    let dirty = false

    if (!params.has('tab') && params.has('pview')) {
      params.set('tab', 'providers')
      dirty = true
    }

    // Drop nested deep-link params when their parent tab is not active so
    // compact (max-xl) nav never keeps Tools/Accounts chips after leaving.
    if (activeView !== 'providers' && (params.has('pview') || params.has('paccount'))) {
      params.delete('pview')
      params.delete('paccount')
      dirty = true
    }

    if (activeView !== 'keys' && params.has('kview')) {
      params.delete('kview')
      dirty = true
    }

    if (dirty) {
      navigate({ hash, pathname, search: `?${params.toString()}` }, { replace: true })
    }
  }, [activeView, hash, navigate, pathname, search])

  const openProviderView = (view: ProviderView) => {
    setActiveView('providers')
    setProviderView(view)
  }

  const openKeysView = (view: KeysView) => {
    setActiveView('keys')
    setKeysView(view)
  }

  const openSettingsView = (view: SettingsViewId) => {
    setActiveView(view)
  }

  // Compact header wraps nav into a single row. Keep nested chips on their own
  // full-width row (not `contents`) so they unmount cleanly with the parent.
  const nestedNavClass =
    'ml-3.5 flex flex-col gap-0.5 pl-1.5 max-xl:ml-0 max-xl:w-full max-xl:basis-full max-xl:flex-row max-xl:flex-wrap max-xl:gap-1 max-xl:border-border/20 max-xl:pl-0'

  const importInputRef = useRef<HTMLInputElement | null>(null)

  const exportConfig = async () => {
    try {
      const cfg = await getHermesConfigRecord()
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'verxio-config.json'
      a.click()
      URL.revokeObjectURL(url)
      triggerHaptic('success')
    } catch (err) {
      notifyError(err, t.settings.exportFailed)
    }
  }

  const resetConfig = async () => {
    try {
      await saveHermesConfig(await getHermesConfigDefaults())
      triggerHaptic('success')
      onConfigSaved?.()
    } catch (err) {
      notifyError(err, t.settings.resetFailed)
    }
  }

  const panelFallback = <LoadingState label={t.common.loading} />

  return (
    <OverlayView closeLabel={t.settings.closeSettings} onClose={onClose}>
      <OverlaySplitLayout>
        <OverlaySidebar>
          {SECTIONS.map(s => {
            const view = `config:${s.id}` as SettingsViewId

            return (
              <OverlayNavItem
                active={activeView === view}
                icon={s.icon}
                key={s.id}
                label={t.settings.sections[s.id] ?? s.label}
                onClick={() => openSettingsView(view)}
              />
            )
          })}
          <div className="my-2 h-px bg-border/30 max-xl:hidden" />
          <OverlayNavItem
            active={activeView === 'providers'}
            icon={Zap}
            label={t.settings.nav.providers}
            onClick={() => openSettingsView('providers')}
          />
          {activeView === 'providers' && (
            <div className={nestedNavClass}>
              <OverlayNavItem
                active={providerView === 'accounts'}
                icon={Sparkles}
                label={t.settings.nav.providerAccounts}
                nested
                onClick={() => openProviderView('accounts')}
              />
              <OverlayNavItem
                active={providerView === 'keys'}
                icon={KeyRound}
                label={t.settings.nav.providerApiKeys}
                nested
                onClick={() => openProviderView('keys')}
              />
            </div>
          )}
          <OverlayNavItem
            active={activeView === 'keys'}
            icon={KeyRound}
            label={t.settings.nav.apiKeys}
            onClick={() => openSettingsView('keys')}
          />
          {activeView === 'keys' && (
            <div className={nestedNavClass}>
              <OverlayNavItem
                active={keysView === 'tools'}
                icon={Wrench}
                label={t.settings.nav.keysTools}
                nested
                onClick={() => openKeysView('tools')}
              />
              <OverlayNavItem
                active={keysView === 'transcription'}
                icon={Mic}
                label={t.settings.nav.keysTranscription}
                nested
                onClick={() => openKeysView('transcription')}
              />
              <OverlayNavItem
                active={keysView === 'settings'}
                icon={Settings2}
                label={t.settings.nav.keysSettings}
                nested
                onClick={() => openKeysView('settings')}
              />
            </div>
          )}
          <OverlayNavItem
            active={activeView === 'mcp'}
            icon={Wrench}
            label={t.settings.nav.mcp}
            onClick={() => openSettingsView('mcp')}
          />
          <OverlayNavItem
            active={activeView === 'notifications'}
            icon={Bell}
            label={t.settings.nav.notifications}
            onClick={() => openSettingsView('notifications')}
          />
          <OverlayNavItem
            active={activeView === 'sessions'}
            icon={Archive}
            label={t.settings.nav.archivedChats}
            onClick={() => openSettingsView('sessions')}
          />
          <div className="my-2 h-px bg-border/30 max-xl:hidden" />
          <OverlayNavItem
            active={activeView === 'about'}
            icon={Info}
            label={t.settings.nav.about}
            onClick={() => openSettingsView('about')}
          />
          <div className="mt-auto flex items-center gap-1 pt-2 max-xl:mt-0 max-xl:ml-auto max-xl:pt-0">
            <Tip label={t.settings.exportConfig}>
              <OverlayIconButton onClick={() => void exportConfig()}>
                <IconDownload className="size-3.5" />
              </OverlayIconButton>
            </Tip>
            <Tip label={t.settings.importConfig}>
              <OverlayIconButton
                onClick={() => {
                  triggerHaptic('open')
                  importInputRef.current?.click()
                }}
              >
                <IconUpload className="size-3.5" />
              </OverlayIconButton>
            </Tip>
            <Tip label={t.settings.resetToDefaults}>
              <OverlayIconButton
                className="hover:text-destructive"
                onClick={() => {
                  triggerHaptic('warning')
                  setConfirmResetOpen(true)
                }}
              >
                <IconRefresh className="size-3.5" />
              </OverlayIconButton>
            </Tip>
          </div>
        </OverlaySidebar>

        <OverlayMain className="px-0 pb-0 pt-[calc(var(--titlebar-height)+1rem)]">
          {/* Remount when leaving a panel family so compact layout never keeps
              the previous tab's body painted under a new title. */}
          <Suspense fallback={panelFallback} key={activeView.startsWith('config:') ? 'config' : activeView}>
            {activeView === 'config:appearance' ? (
              <AppearanceSettings />
            ) : activeView === 'about' ? (
              <AboutSettings />
            ) : activeView.startsWith('config:') ? (
              <ConfigSettings
                activeSectionId={activeView.slice('config:'.length)}
                importInputRef={importInputRef}
                onConfigSaved={onConfigSaved}
              />
            ) : activeView === 'providers' ? (
              <ProvidersSettings
                onInferenceApplied={onConfigSaved}
                onViewChange={setProviderView}
                requestGateway={requestGateway}
                view={providerView}
              />
            ) : activeView === 'keys' ? (
              <KeysSettings view={keysView} />
            ) : activeView === 'mcp' ? (
              <McpSettings gateway={gateway} onConfigSaved={onConfigSaved} />
            ) : activeView === 'notifications' ? (
              <NotificationsSettings />
            ) : (
              <SessionsSettings />
            )}
          </Suspense>
        </OverlayMain>
      </OverlaySplitLayout>
      <ConfirmDialog
        busyLabel={t.common.loading}
        confirmLabel={t.settings.resetToDefaults}
        destructive
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={resetConfig}
        open={confirmResetOpen}
        title={t.settings.resetConfirm}
      />
    </OverlayView>
  )
}

export { SettingsView as SettingsPage }
