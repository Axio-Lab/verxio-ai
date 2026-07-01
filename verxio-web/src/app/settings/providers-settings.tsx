import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import {
  ConnectAccountFeaturedRow,
  FeaturedProviderRow,
  KeyProviderRow,
  ProviderRow,
  sortProviders
} from '@/components/desktop-onboarding-overlay'
import { Button } from '@/components/ui/button'
import { PaginationControl } from '@/components/ui/pagination'
import { listOAuthProviders } from '@/hermes'
import { useI18n } from '@/i18n'
import { ChevronDown, KeyRound } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { oauthProvidersForProduct, usesVerxioConnectAccountPicker } from '@/lib/verxio-oauth-providers'
import { $desktopOnboarding } from '@/store/onboarding'
import type { EnvVarInfo, OAuthProvider } from '@/types/hermes'

import { DEFAULT_LIST_PAGE_SIZE, usePaginatedList } from '../hooks/use-paginated-list'

import { isKeyVar, ProviderKeyRows } from './credential-key-ui'
import { SettingsCategoryHeading, useEnvCredentials } from './env-credentials'
import { providerGroup, providerMeta, providerPriority } from './helpers'
import { InferenceProviderSettings } from './inference-provider-settings'
import { LoadingState, SettingsContent } from './primitives'
import { ProviderAccountSetup } from './provider-account-setup'

// Sub-views surfaced as a sidebar subnav: account sign-in vs raw API keys.
export const PROVIDER_VIEWS = ['accounts', 'keys'] as const

export type ProviderView = (typeof PROVIDER_VIEWS)[number]

// Group the env catalog by provider — one ListRow per vendor plus optional
// advanced overrides (base URL, region, etc.). Groups without a key field and
// the "Other" bucket are skipped.
function buildProviderKeyGroups(vars: Record<string, EnvVarInfo>): ProviderKeyGroup[] {
  const buckets = new Map<string, [string, EnvVarInfo][]>()

  for (const [key, info] of Object.entries(vars)) {
    if (info.category !== 'provider') {
      continue
    }

    const name = providerGroup(key)

    if (name === 'Other') {
      continue
    }

    buckets.set(name, [...(buckets.get(name) ?? []), [key, info]])
  }

  const groups: ProviderKeyGroup[] = []

  for (const [name, entries] of buckets) {
    const primary = entries.find(([k, i]) => !i.advanced && isKeyVar(k, i)) ?? entries.find(([k, i]) => isKeyVar(k, i))

    if (!primary) {
      continue
    }

    const meta = providerMeta(name)

    groups.push({
      // Advanced = the provider's non-key knobs (base URL, region, deployment).
      // Skip redundant alias key vars (e.g. ANTHROPIC_TOKEN vs ANTHROPIC_API_KEY)
      // so we never render a second "Paste key" input — unless one is already
      // set, in which case keep it visible so it stays clearable.
      advanced: entries
        .filter(([k, i]) => k !== primary[0] && (!isKeyVar(k, i) || i.is_set))
        .sort(([a], [b]) => a.localeCompare(b)),
      description: meta?.description ?? primary[1].description,
      docsUrl: meta?.docsUrl ?? primary[1].url ?? undefined,
      hasAnySet: entries.some(([, i]) => i.is_set),
      name,
      primary,
      priority: providerPriority(name)
    })
  }

  return groups.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

// Deliberately a near-1:1 replica of the first-run onboarding picker
// (`Picker` in desktop-onboarding-overlay): same recommended card, same
// provider rows, same "Other providers" disclosure, same OpenRouter quick-key
// row, and the same bottom-right "I have an API key" affordance. The leaf cards
// are the exact shared components, so the two surfaces stay visually identical.
// Selecting a provider hands off to the shared onboarding overlay, which runs
// that provider's real sign-in flow; the key affordances open the API-key
// catalog below.
function OAuthPicker({
  onSelectProvider,
  onWantApiKey,
  providers
}: {
  onSelectProvider: (provider: OAuthProvider) => void
  onWantApiKey: () => void
  providers: OAuthProvider[]
}) {
  const { t } = useI18n()
  const p = t.settings.providers
  const [showAll, setShowAll] = useState(false)
  const verxioConnectPicker = usesVerxioConnectAccountPicker()
  const ordered = useMemo(() => sortProviders(oauthProvidersForProduct(providers)), [providers])

  if (ordered.length === 0) {
    return null
  }

  const select = (provider: OAuthProvider) => onSelectProvider(provider)

  const featured = verxioConnectPicker ? null : (ordered.find(item => item.id === 'nous') ?? null)
  const rest = featured ? ordered.filter(item => item.id !== featured.id) : ordered
  const connected = rest.filter(item => item.status?.logged_in)
  const others = rest.filter(item => !item.status?.logged_in)
  const collapsible = verxioConnectPicker ? others.length > 0 : Boolean(featured) && others.length > 0
  const showOthers = !collapsible || showAll

  return (
    <section className="mb-5 grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <SettingsCategoryHeading icon={KeyRound} title={p.connectAccount} />
        <Button
          className="text-(length:--conversation-caption-font-size)"
          onClick={onWantApiKey}
          size="inline"
          type="button"
          variant="textStrong"
        >
          {p.haveApiKey}
        </Button>
      </div>
      <p className="-mt-2 mb-1 text-(length:--conversation-caption-font-size) leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {p.intro}
      </p>
      {verxioConnectPicker && collapsible && !showAll ? (
        <ConnectAccountFeaturedRow onExpand={() => setShowAll(true)} pitch={p.connectAccountFeaturedPitch} />
      ) : null}
      {!verxioConnectPicker && featured ? <FeaturedProviderRow onSelect={select} provider={featured} /> : null}
      {connected.length > 0 && (
        <>
          <p className="mt-1 px-0.5 text-(length:--conversation-caption-font-size) font-medium text-(--ui-text-tertiary)">
            {p.connected}
          </p>
          {connected.map(provider => (
            <ProviderRow key={provider.id} onSelect={select} provider={provider} />
          ))}
        </>
      )}
      {showOthers && (
        <>
          {others.map(provider => (
            <ProviderRow key={provider.id} onSelect={select} provider={provider} />
          ))}
          <KeyProviderRow onClick={onWantApiKey} />
        </>
      )}
      {collapsible && (
        <Button
          className="py-1 text-(length:--conversation-caption-font-size)"
          onClick={() => setShowAll(value => !value)}
          size="inline"
          type="button"
          variant="text"
        >
          {showAll ? p.collapse : connected.length > 0 ? p.connectAnother : p.otherProviders}
          <ChevronDown className={cn('size-3.5 transition', showAll && 'rotate-180')} />
        </Button>
      )}
    </section>
  )
}

function NoProviderKeys() {
  const { t } = useI18n()

  return (
    <div className="grid min-h-32 place-items-center px-4 py-8 text-center text-(length:--conversation-caption-font-size) text-muted-foreground">
      {t.settings.providers.noProviderKeys}
    </div>
  )
}

export function ProvidersSettings({ onViewChange, view }: ProvidersSettingsProps) {
  const { t } = useI18n()
  const { rowProps, vars } = useEnvCredentials()
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState<null | string>(null)
  const [openProvider, setOpenProvider] = useState<null | string>(null)
  // The onboarding overlay owns the OAuth flow. Watch its `manual` flag so we
  // re-read connection state when the user finishes (or dismisses) a sign-in
  // they launched from this page — otherwise the cards keep their stale status.
  const onboardingActive = useStore($desktopOnboarding).manual

  const refreshOAuthProviders = async () => {
    try {
      const { providers } = await listOAuthProviders()
      setOauthProviders(providers)
    } catch {
      // Ignore — the OAuth panel just won't render.
    }
  }

  useEffect(() => {
    if (onboardingActive) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const { providers } = await listOAuthProviders()

        if (!cancelled) {
          setOauthProviders(providers)
        }
      } catch {
        // Ignore — the OAuth panel just won't render.
      }
    })()

    return () => void (cancelled = true)
  }, [onboardingActive])

  const keyGroups = useMemo(() => (vars ? buildProviderKeyGroups(vars) : []), [vars])

  const {
    currentPage,
    setPage,
    total,
    visibleItems: visibleKeyGroups
  } = usePaginatedList(keyGroups, DEFAULT_LIST_PAGE_SIZE, view)

  if (!vars) {
    return <LoadingState label={t.settings.providers.loading} />
  }

  const hasOauth = oauthProviders.length > 0
  const activeProvider = oauthProviders.find(provider => provider.id === activeProviderId) ?? null
  // The sidebar subnav owns the Accounts/API-keys split now; with no OAuth
  // providers there's nothing for the "Accounts" view to show, so fall to keys.
  const showApiKeys = view === 'keys' || !hasOauth

  if (showApiKeys) {
    return (
      <SettingsContent>
        {keyGroups.length > 0 ? (
          <div className="grid gap-2">
            {visibleKeyGroups.map(group => (
              <ProviderKeyRows
                expanded={openProvider === group.name}
                group={group}
                key={group.name}
                onExpand={() => setOpenProvider(group.name)}
                onToggle={() => setOpenProvider(prev => (prev === group.name ? null : group.name))}
                rowProps={rowProps}
              />
            ))}
            <PaginationControl
              className="pt-2"
              itemLabel="providers"
              onPageChange={setPage}
              page={currentPage}
              pageSize={DEFAULT_LIST_PAGE_SIZE}
              total={total}
            />
          </div>
        ) : (
          <NoProviderKeys />
        )}
      </SettingsContent>
    )
  }

  return (
    <SettingsContent>
      {activeProvider ? (
        <ProviderAccountSetup
          onBack={() => setActiveProviderId(null)}
          onUpdated={refreshOAuthProviders}
          provider={activeProvider}
        />
      ) : (
        <>
          <InferenceProviderSettings onOpenProviderKeys={() => onViewChange('keys')} />
          <OAuthPicker
            onSelectProvider={provider => setActiveProviderId(provider.id)}
            onWantApiKey={() => onViewChange('keys')}
            providers={oauthProviders}
          />
        </>
      )}
    </SettingsContent>
  )
}

interface ProviderKeyGroup {
  advanced: [string, EnvVarInfo][]
  description?: string
  docsUrl?: string
  hasAnySet: boolean
  name: string
  primary: [string, EnvVarInfo]
  priority: number
}

interface ProvidersSettingsProps {
  onViewChange: (view: ProviderView) => void
  view: ProviderView
}
