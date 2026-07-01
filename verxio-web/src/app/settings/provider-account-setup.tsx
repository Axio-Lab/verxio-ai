import { useState } from 'react'

import { ConnectedTag, providerTitle } from '@/components/desktop-onboarding-overlay'
import { Button } from '@/components/ui/button'
import { disconnectOAuthProvider } from '@/hermes'
import { useI18n } from '@/i18n'
import { ChevronLeft, Loader2 } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import { startManualProviderOAuth } from '@/store/onboarding'
import type { OAuthProvider } from '@/types/hermes'

interface ProviderAccountSetupProps {
  onBack: () => void
  onUpdated: () => Promise<void> | void
  provider: OAuthProvider
}

export function ProviderAccountSetup({ onBack, onUpdated, provider }: ProviderAccountSetupProps) {
  const { t } = useI18n()
  const copy = t.settings.providers
  const title = providerTitle(provider)
  const loggedIn = provider.status?.logged_in
  const canDisconnect = provider.disconnectable ?? provider.flow !== 'external'
  const [disconnecting, setDisconnecting] = useState(false)

  const handleSignIn = () => {
    startManualProviderOAuth(provider.id)
  }

  const handleDisconnect = async () => {
    if (!window.confirm(copy.removeConfirm(title))) {
      return
    }

    setDisconnecting(true)

    try {
      await disconnectOAuthProvider(provider.id)
      notify({
        durationMs: 3_000,
        kind: 'success',
        title: copy.removedTitle,
        message: copy.removedMessage(title)
      })
      await onUpdated()
    } catch (error) {
      notifyError(error, copy.failedRemove(title))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="grid gap-4">
      <Button className="w-fit px-0" onClick={onBack} size="inline" type="button" variant="text">
        <ChevronLeft className="size-4" />
        {t.common.back}
      </Button>

      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[length:var(--conversation-text-font-size)] font-semibold">{title}</h2>
          {loggedIn ? <ConnectedTag /> : null}
        </div>
        <p className="text-(length:--conversation-caption-font-size) leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {t.onboarding.flowSubtitles[provider.flow]}
        </p>
      </div>

      {loggedIn && provider.status?.token_preview ? (
        <p className="text-(length:--conversation-caption-font-size) text-muted-foreground">
          {copy.accountLabel}: {provider.status.token_preview}
        </p>
      ) : null}

      {!loggedIn && provider.flow === 'external' ? (
        <p className="text-(length:--conversation-caption-font-size) text-muted-foreground">
          {copy.removeExternalGeneric(title)}
        </p>
      ) : null}

      {!loggedIn && provider.flow !== 'external' ? (
        <Button onClick={handleSignIn} type="button">
          {t.common.connect}
        </Button>
      ) : null}

      {loggedIn ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={disconnecting} onClick={() => void handleDisconnect()} type="button" variant="destructive">
            {disconnecting ? <Loader2 className="size-4 animate-spin" /> : null}
            {copy.disconnect}
          </Button>
          {provider.flow !== 'external' ? (
            <Button disabled={disconnecting} onClick={handleSignIn} type="button" variant="secondary">
              {copy.reconnect}
            </Button>
          ) : null}
        </div>
      ) : null}

      {loggedIn && !canDisconnect ? (
        <p className="text-(length:--conversation-caption-font-size) text-muted-foreground">
          {provider.disconnect_hint ?? copy.removeExternalGeneric(title)}
        </p>
      ) : null}
    </div>
  )
}
