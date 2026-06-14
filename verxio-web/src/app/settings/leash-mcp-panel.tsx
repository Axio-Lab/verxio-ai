import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { Info } from '@/lib/icons'
import {
  buildLeashAgentDraft,
  clearLeashAgent,
  exportLeashAgentJson,
  isLeashIdentityConfigured,
  leashIdentityPhase,
  mergeLeashAgentFromRuntime,
  parseLeashAgentJson
} from '@/lib/leash/identity'
import {
  executivePublicKeyBase58,
  generateExecutiveKeypairBase58,
  importExecutiveKeypairBase58,
  normalizeLeashNetwork
} from '@/lib/leash/keypair'
import {
  clearLeashAgentOnRuntime,
  disableLeashMcpServer,
  hydrateLeashIdentity,
  pullLeashAgentFromRuntime
} from '@/lib/leash/sync'
import type { LeashNetwork } from '@/lib/leash/types'
import { $leashAgent, persistLeashAgent, refreshLeashIdentityState } from '@/store/leash-identity'
import { notify, notifyError } from '@/store/notifications'

import { Pill } from './primitives'

interface LeashMcpPanelProps {
  onReloadMcp?: () => Promise<void>
}

export function LeashMcpPanel({ onReloadMcp }: LeashMcpPanelProps) {
  const { t } = useI18n()
  const copy = t.leash.panel
  const current = useStore($leashAgent)
  const [network, setNetwork] = useState<LeashNetwork>('solana-devnet')
  const [rpcUrl, setRpcUrl] = useState('')
  const [importKey, setImportKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setNetwork(normalizeLeashNetwork(current?.network))
    setRpcUrl(current?.rpc_url ?? '')
  }, [current])

  const phase = leashIdentityPhase(current)
  const configured = isLeashIdentityConfigured(current)
  const executiveKey = current?.executive_keypair ?? current?.pending_register?.executive_keypair
  const executivePubkey = executiveKey ? executivePublicKeyBase58(executiveKey) : null

  async function saveAndHydrate(next: NonNullable<typeof current>) {
    setBusy(true)

    try {
      persistLeashAgent(next)
      await hydrateLeashIdentity(next)

      if (onReloadMcp) {
        await onReloadMcp()
      }

      notify({ kind: 'success', title: copy.savedTitle, message: copy.savedMessage })
    } catch (err) {
      notifyError(err, copy.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  async function handleGenerate() {
    try {
      const executiveKeypair = await generateExecutiveKeypairBase58()

      const draft = buildLeashAgentDraft({
        executiveKeypair,
        network,
        rpcUrl
      })

      await saveAndHydrate(draft)
    } catch (err) {
      notifyError(err, copy.generateFailed)
    }
  }

  async function handleImport() {
    try {
      const executiveKeypair = importExecutiveKeypairBase58(importKey)

      const draft = buildLeashAgentDraft({
        executiveKeypair,
        network,
        rpcUrl
      })

      setImportKey('')
      await saveAndHydrate(draft)
    } catch (err) {
      notifyError(err, copy.importFailed)
    }
  }

  async function handlePullFromRuntime() {
    setBusy(true)

    try {
      const remote = await pullLeashAgentFromRuntime()

      if (!remote) {
        notify({ kind: 'info', title: copy.pullEmptyTitle, message: copy.pullEmptyMessage })

        return
      }

      const merged = mergeLeashAgentFromRuntime(remote)
      persistLeashAgent(merged)
      notify({ kind: 'success', title: copy.pullSavedTitle, message: copy.pullSavedMessage })
    } catch (err) {
      notifyError(err, copy.pullFailed)
    } finally {
      setBusy(false)
    }
  }

  function handleExport() {
    const blob = new Blob([exportLeashAgentJson(current ?? {})], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'leash-agent.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(file: File) {
    try {
      const parsed = parseLeashAgentJson(await file.text())
      await saveAndHydrate(parsed)
    } catch (err) {
      notifyError(err, copy.importFailed)
    }
  }

  async function handleRemove() {
    if (!window.confirm(copy.removeConfirm)) {
      return
    }

    setBusy(true)

    try {
      clearLeashAgent()
      await clearLeashAgentOnRuntime()
      await disableLeashMcpServer()
      refreshLeashIdentityState()

      if (onReloadMcp) {
        await onReloadMcp()
      }

      notify({ kind: 'success', title: copy.removedTitle, message: copy.removedMessage })
    } catch (err) {
      notifyError(err, copy.removeFailed)
    } finally {
      setBusy(false)
    }
  }

  const statusLabel =
    phase === 'registered'
      ? copy.statusRegistered
      : phase === 'pending_funding'
        ? copy.statusPendingFunding
        : copy.statusNone

  return (
    <section className="mb-6 grid gap-4 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{copy.title}</h3>
          <p className="mt-1 text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
            {copy.subtitle}
          </p>
        </div>
        <Pill>{statusLabel}</Pill>
      </div>

      <div className="flex gap-2 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) p-3 text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>{copy.custodyNotice}</p>
      </div>

      {configured && current?.agent_mint && (
        <dl className="grid gap-2 text-[length:var(--conversation-caption-font-size)]">
          <div>
            <dt className="text-muted-foreground">{copy.mintLabel}</dt>
            <dd className="font-mono text-xs">{current.agent_mint}</dd>
          </div>
          {current.treasury_address && (
            <div>
              <dt className="text-muted-foreground">{copy.treasuryLabel}</dt>
              <dd className="font-mono text-xs">{current.treasury_address}</dd>
            </div>
          )}
        </dl>
      )}

      {executivePubkey && (
        <div className="text-[length:var(--conversation-caption-font-size)]">
          <div className="text-muted-foreground">{copy.executiveLabel}</div>
          <div className="font-mono text-xs">{executivePubkey}</div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">{copy.networkLabel}</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            onChange={event => setNetwork(event.currentTarget.value as LeashNetwork)}
            value={network}
          >
            <option value="solana-devnet">{copy.networkDevnet}</option>
            <option value="solana-mainnet">{copy.networkMainnet}</option>
          </select>
        </label>
        <label className="grid gap-1.5 sm:col-span-2">
          <span className="text-xs text-muted-foreground">{copy.rpcLabel}</span>
          <Input
            onChange={event => setRpcUrl(event.currentTarget.value)}
            placeholder={copy.rpcPlaceholder}
            value={rpcUrl}
          />
        </label>
      </div>

      {!executiveKey && (
        <div className="grid gap-3">
          <Button disabled={busy} onClick={() => void handleGenerate()} size="sm" type="button">
            {copy.generateKeypair}
          </Button>
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">{copy.importLabel}</span>
            <Textarea
              className="min-h-20 font-mono text-xs"
              onChange={event => setImportKey(event.currentTarget.value)}
              placeholder={copy.importPlaceholder}
              spellCheck={false}
              value={importKey}
            />
          </label>
          <Button
            disabled={busy || !importKey.trim()}
            onClick={() => void handleImport()}
            size="sm"
            type="button"
            variant="outline"
          >
            {copy.importKeypair}
          </Button>
        </div>
      )}

      {phase === 'pending_funding' && (
        <p className="text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
          {copy.pendingFundingHint}
        </p>
      )}

      {configured && (
        <p className="text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
          {copy.registeredHint}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={handleExport} size="xs" type="button" variant="outline">
          {copy.exportJson}
        </Button>
        <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-2 py-1 text-xs hover:bg-accent">
          {copy.importJson}
          <input
            accept="application/json,.json"
            className="sr-only"
            onChange={event => {
              const file = event.currentTarget.files?.[0]

              if (file) {
                void handleImportFile(file)
              }

              event.currentTarget.value = ''
            }}
            type="file"
          />
        </label>
        <Button disabled={busy} onClick={() => void handlePullFromRuntime()} size="xs" type="button" variant="text">
          {copy.pullFromRuntime}
        </Button>
        {executiveKey && (
          <Button
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => void handleRemove()}
            size="xs"
            type="button"
            variant="text"
          >
            {copy.removeIdentity}
          </Button>
        )}
      </div>

      {phase !== 'none' && <p className="text-[0.62rem] text-muted-foreground">{copy.chatHint}</p>}
    </section>
  )
}
