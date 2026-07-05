import { useState } from 'react'

import { ConnectedTag, providerTitle } from '@/components/desktop-onboarding-overlay'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { disconnectOAuthProvider } from '@/hermes'
import { useI18n } from '@/i18n'
import { ChevronLeft, Loader2 } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import {
  type OnboardingContext,
  startManualProviderOAuth,
  verifyExternalProviderFromSettings
} from '@/store/onboarding'
import type { OAuthProvider } from '@/types/hermes'

interface ProviderAccountSetupProps {
  onBack: () => void
  onUpdated: () => Promise<void> | void
  provider: OAuthProvider
  requestGateway: OnboardingContext['requestGateway']
}

function ProviderCliCommand({ command, copied, onCopy }: { command: string; copied: boolean; onCopy: () => void }) {
  const { t } = useI18n()

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-(--stroke-nous) px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-sm">
        <span className="mr-2 select-none text-muted-foreground">$</span>
        {command}
      </code>
      <Button onClick={onCopy} size="sm" type="button" variant="outline">
        {copied ? t.common.copied : t.onboarding.copy}
      </Button>
    </div>
  )
}

export function ProviderAccountSetup({ onBack, onUpdated, provider, requestGateway }: ProviderAccountSetupProps) {
  const { t } = useI18n()
  const copy = t.settings.providers
  const title = providerTitle(provider)
  const loggedIn = provider.status?.logged_in
  const canDisconnect = provider.disconnectable ?? provider.flow !== 'external'
  const isExternal = provider.flow === 'external'
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [externalError, setExternalError] = useState<null | string>(null)
  const [verifyingExternal, setVerifyingExternal] = useState(false)

  const handleSignIn = () => {
    startManualProviderOAuth(provider.id)
  }

  const copyCommand = async () => {
    if (!provider.cli_command) {
      return
    }

    try {
      await navigator.clipboard.writeText(provider.cli_command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Non-fatal — the command is still visible for manual copy.
    }
  }

  const handleExternalSignedIn = async () => {
    setVerifyingExternal(true)
    setExternalError(null)

    const result = await verifyExternalProviderFromSettings(provider, { requestGateway })

    setVerifyingExternal(false)

    if (!result.ok) {
      setExternalError(result.message)

      return
    }

    notify({
      durationMs: 3_000,
      kind: 'success',
      title: t.onboarding.connected,
      message: t.onboarding.connectedProvider(title)
    })
    await onUpdated()
  }

  const runDisconnect = async () => {
    setDisconnecting(true)

    try {
      const result = await disconnectOAuthProvider(provider.id)

      if (!result.ok) {
        throw new Error(copy.failedRemove(title))
      }

      notify({
        durationMs: 3_000,
        kind: 'success',
        title: copy.removedTitle,
        message: copy.removedMessage(title)
      })
      await onUpdated()
    } catch (error) {
      notifyError(error, copy.failedRemove(title))
      throw error
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <>
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

        {!loggedIn && isExternal && provider.cli_command ? (
          <div className="grid gap-3">
            <p className="text-(length:--conversation-caption-font-size) text-muted-foreground">
              {t.onboarding.externalPending(title)}
            </p>
            <ProviderCliCommand command={provider.cli_command} copied={copied} onCopy={() => void copyCommand()} />
            {externalError ? (
              <p className="text-(length:--conversation-caption-font-size) text-destructive">{externalError}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {provider.docs_url ? (
                <Button asChild size="sm" type="button" variant="outline">
                  <a href={provider.docs_url} rel="noreferrer" target="_blank">
                    {t.onboarding.docs(title)}
                  </a>
                </Button>
              ) : null}
              <Button disabled={verifyingExternal} onClick={() => void handleExternalSignedIn()} type="button">
                {verifyingExternal ? <Loader2 className="size-4 animate-spin" /> : null}
                {t.onboarding.signedIn}
              </Button>
            </div>
          </div>
        ) : null}

        {!loggedIn && !isExternal ? (
          <Button onClick={handleSignIn} type="button">
            {t.common.connect}
          </Button>
        ) : null}

        {loggedIn ? (
          <div className="flex flex-wrap gap-2">
            {canDisconnect ? (
              <Button
                disabled={disconnecting}
                onClick={() => setConfirmDisconnectOpen(true)}
                type="button"
                variant="destructive"
              >
                {disconnecting ? <Loader2 className="size-4 animate-spin" /> : null}
                {copy.disconnect}
              </Button>
            ) : null}
            {!isExternal ? (
              <Button disabled={disconnecting} onClick={handleSignIn} type="button" variant="secondary">
                {copy.reconnect}
              </Button>
            ) : null}
          </div>
        ) : null}

        {loggedIn && !canDisconnect ? (
          <div className="grid gap-3">
            <p className="text-(length:--conversation-caption-font-size) text-muted-foreground">
              {provider.disconnect_hint ?? copy.removeExternalGeneric(title)}
            </p>
            {provider.cli_command ? (
              <ProviderCliCommand command={provider.cli_command} copied={copied} onCopy={() => void copyCommand()} />
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        confirmLabel={copy.disconnect}
        destructive
        onClose={() => setConfirmDisconnectOpen(false)}
        onConfirm={runDisconnect}
        open={confirmDisconnectOpen}
        title={copy.removeConfirm(title)}
      />
    </>
  )
}
