import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PaginationControl } from '@/components/ui/pagination'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  completeComposioConnection,
  type ComposioApp,
  type ComposioAuthInputField,
  type ComposioAuthMode,
  type ComposioConnectedAccount,
  type ComposioConnectionSetupResponse,
  type ComposioToolPreview,
  disconnectComposioAccount,
  getComposioConnectionSetup,
  initiateComposioConnection,
  listComposioApps,
  listComposioAppTools,
  listComposioConnections
} from '@/lib/verxio-api'
import { notify, notifyError } from '@/store/notifications'

import { PAGE_INSET_X } from '../layout-constants'
import { includesQuery } from '../settings/helpers'

const FALLBACK_COMPOSIO_APPS: ComposioApp[] = [
  {
    categories: ['email', 'sales'],
    description: 'Read, draft, and organize business email workflows.',
    logoUrl: null,
    name: 'Gmail',
    noAuth: false,
    slug: 'gmail'
  },
  {
    categories: ['spreadsheet', 'reporting'],
    description: 'Create reports, update rows, and analyze operating data.',
    logoUrl: null,
    name: 'Google Sheets',
    noAuth: false,
    slug: 'googlesheets'
  },
  {
    categories: ['files', 'knowledge'],
    description: 'Search files, summarize folders, and organize shared assets.',
    logoUrl: null,
    name: 'Google Drive',
    noAuth: false,
    slug: 'googledrive'
  },
  {
    categories: ['calendar', 'operations'],
    description: 'Schedule meetings, inspect calendars, and coordinate handoffs.',
    logoUrl: null,
    name: 'Google Calendar',
    noAuth: false,
    slug: 'googlecalendar'
  },
  {
    categories: ['documents', 'content'],
    description: 'Draft docs, update briefs, and turn notes into deliverables.',
    logoUrl: null,
    name: 'Google Docs',
    noAuth: false,
    slug: 'googledocs'
  },
  {
    categories: ['team', 'messages'],
    description: 'Read channels, summarize decisions, and send team updates.',
    logoUrl: null,
    name: 'Slack',
    noAuth: false,
    slug: 'slack'
  },
  {
    categories: ['knowledge', 'project'],
    description: 'Search pages, update databases, and maintain internal systems.',
    logoUrl: null,
    name: 'Notion',
    noAuth: false,
    slug: 'notion'
  },
  {
    categories: ['database', 'crm'],
    description: 'Build lightweight CRMs, update records, and sync field data.',
    logoUrl: null,
    name: 'Airtable',
    noAuth: false,
    slug: 'airtable'
  },
  {
    categories: ['crm', 'sales'],
    description: 'Manage contacts, companies, deals, and follow-up workflows.',
    logoUrl: null,
    name: 'HubSpot',
    noAuth: false,
    slug: 'hubspot'
  },
  {
    categories: ['code', 'project'],
    description: 'Inspect issues, open pull requests, and manage repository work.',
    logoUrl: null,
    name: 'GitHub',
    noAuth: false,
    slug: 'github'
  },
  {
    categories: ['project', 'engineering'],
    description: 'Track issues, update roadmaps, and prepare delivery reports.',
    logoUrl: null,
    name: 'Linear',
    noAuth: false,
    slug: 'linear'
  },
  {
    categories: ['project', 'support'],
    description: 'Create tickets, triage work, and summarize delivery status.',
    logoUrl: null,
    name: 'Jira',
    noAuth: false,
    slug: 'jira'
  },
  {
    categories: ['payments', 'finance'],
    description: 'Review customers, invoices, payments, and revenue workflows.',
    logoUrl: null,
    name: 'Stripe',
    noAuth: false,
    slug: 'stripe'
  },
  {
    categories: ['community', 'messages'],
    description: 'Read servers, post updates, and coordinate community operations.',
    logoUrl: null,
    name: 'Discord',
    noAuth: false,
    slug: 'discord'
  },
  {
    categories: ['support', 'messages'],
    description: 'Route customer conversations and prepare response workflows.',
    logoUrl: null,
    name: 'WhatsApp',
    noAuth: false,
    slug: 'whatsapp'
  }
]

const TOOLS_DIALOG_LIMIT = 50

function resolveAuthMode(app: ComposioApp): ComposioAuthMode {
  if (app.authMode) {
    return app.authMode
  }

  if (app.connectable === false) {
    return 'requires_oauth_app'
  }

  return 'managed_oauth'
}

function isAppConnectable(app: ComposioApp): boolean {
  return resolveAuthMode(app) !== 'requires_oauth_app' && app.connectable !== false
}

function authBadgeLabel(app: ComposioApp): string | null {
  if (app.noAuth) {
    return null
  }

  const mode = resolveAuthMode(app)

  if (mode === 'connect_link') {
    if (app.authSchemes?.includes('API_KEY')) {
      return 'API key'
    }

    if (app.authSchemes?.includes('BASIC')) {
      return 'Credentials'
    }

    return 'Credentials required'
  }

  if (mode === 'requires_oauth_app') {
    return 'OAuth app required'
  }

  return null
}

function composioCallbackUrl(): string {
  return `${window.location.origin}${window.location.pathname}#/skills?tab=connections`
}

function parseComposioCallbackParams(): { status: string; connectedAccountId?: string } | null {
  const searchParams = new URLSearchParams(window.location.search)
  const hash = window.location.hash
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const hashParams = new URLSearchParams(hashQuery)
  const status = searchParams.get('status') || hashParams.get('status')

  if (!status) {
    return null
  }

  return {
    connectedAccountId:
      searchParams.get('connected_account_id') ||
      searchParams.get('connectedAccountId') ||
      hashParams.get('connected_account_id') ||
      hashParams.get('connectedAccountId') ||
      undefined,
    status
  }
}

function clearComposioCallbackParams(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('status')
  url.searchParams.delete('connected_account_id')
  url.searchParams.delete('connectedAccountId')

  if (url.hash.includes('?')) {
    const [hashPath, hashQuery] = url.hash.split('?', 2)
    const hashParams = new URLSearchParams(hashQuery)
    hashParams.delete('status')
    hashParams.delete('connected_account_id')
    hashParams.delete('connectedAccountId')
    const nextQuery = hashParams.toString()
    url.hash = nextQuery ? `${hashPath}?${nextQuery}` : hashPath
  }

  window.history.replaceState({}, '', url.toString())
}

interface ConnectionsPanelProps {
  onPageChange: (page: number) => void
  page: number
  pageSize: number
  query: string
}

export function ConnectionsPanel({ onPageChange, page, pageSize, query }: ConnectionsPanelProps) {
  const [apps, setApps] = useState<ComposioApp[]>(FALLBACK_COMPOSIO_APPS)
  const [accounts, setAccounts] = useState<ComposioConnectedAccount[]>([])
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [toolsDialogApp, setToolsDialogApp] = useState<ComposioApp | null>(null)
  const [toolsDialogItems, setToolsDialogItems] = useState<ComposioToolPreview[]>([])
  const [toolsDialogLoading, setToolsDialogLoading] = useState(false)
  const [toolsDialogError, setToolsDialogError] = useState<string | null>(null)
  const [connectDialogApp, setConnectDialogApp] = useState<ComposioApp | null>(null)
  const [connectSetup, setConnectSetup] = useState<ComposioConnectionSetupResponse | null>(null)
  const [connectSetupLoading, setConnectSetupLoading] = useState(false)
  const [connectSetupError, setConnectSetupError] = useState<string | null>(null)
  const [connectValues, setConnectValues] = useState<Record<string, string>>({})
  const [connectSubmitting, setConnectSubmitting] = useState(false)
  const [connectLinkLoading, setConnectLinkLoading] = useState(false)

  const refreshConnections = useCallback(async () => {
    setLoading(true)

    try {
      const [appsResponse, accountsResponse] = await Promise.all([listComposioApps(), listComposioConnections()])
      const nextApps = appsResponse.apps.length > 0 ? appsResponse.apps : FALLBACK_COMPOSIO_APPS
      const apiConfigured = Boolean(appsResponse.configured && accountsResponse.configured)
      const catalogReady = appsResponse.catalogReady ?? apiConfigured

      setApps(nextApps)
      setAccounts(accountsResponse.accounts)
      setConfigured(apiConfigured)
      setMessage(
        !apiConfigured
          ? 'Add COMPOSIO_API_KEY in the root .env file, then restart verxio-api (docker compose up -d verxio-api).'
          : !catalogReady
            ? appsResponse.catalogError ||
              'Composio rejected the API key. Generate a fresh key in the Composio dashboard and update root .env.'
            : null
      )
    } catch {
      setApps(FALLBACK_COMPOSIO_APPS)
      setAccounts([])
      setConfigured(false)
      setMessage('Composio API routes are not available yet. Showing the Verxio connection catalog.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  useEffect(() => {
    const callback = parseComposioCallbackParams()

    if (!callback) {
      return
    }

    clearComposioCallbackParams()

    if (callback.status === 'success') {
      void refreshConnections().then(() => {
        notify({
          kind: 'success',
          message: callback.connectedAccountId
            ? `Connection ${callback.connectedAccountId} is ready for the agent.`
            : 'Your connection is ready for the agent.',
          title: 'Connection ready'
        })
      })

      return
    }

    notify({
      kind: 'warning',
      message: 'Composio could not finish the connection. Try again or use the inline form when available.',
      title: 'Connection incomplete'
    })
  }, [refreshConnections])

  useEffect(() => {
    if (!connectDialogApp) {
      return
    }

    let cancelled = false

    setConnectSetupLoading(true)
    setConnectSetupError(null)
    setConnectSetup(null)
    setConnectValues({})

    void getComposioConnectionSetup(connectDialogApp.slug)
      .then(response => {
        if (cancelled) {
          return
        }

        setConnectSetup(response)
      })
      .catch(err => {
        if (cancelled) {
          return
        }

        setConnectSetupError(err instanceof Error ? err.message : 'Could not load connection setup.')
      })
      .finally(() => {
        if (!cancelled) {
          setConnectSetupLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectDialogApp])

  useEffect(() => {
    if (!toolsDialogApp) {
      return
    }

    let cancelled = false

    setToolsDialogLoading(true)
    setToolsDialogError(null)
    setToolsDialogItems(toolsDialogApp.sampleTools ?? [])

    void listComposioAppTools(toolsDialogApp.slug, TOOLS_DIALOG_LIMIT)
      .then(response => {
        if (cancelled) {
          return
        }

        setToolsDialogItems(response.tools.length > 0 ? response.tools : (toolsDialogApp.sampleTools ?? []))
      })
      .catch(err => {
        if (cancelled) {
          return
        }

        setToolsDialogError(err instanceof Error ? err.message : 'Could not load tools.')
        setToolsDialogItems(toolsDialogApp.sampleTools ?? [])
      })
      .finally(() => {
        if (!cancelled) {
          setToolsDialogLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [toolsDialogApp])

  const accountByApp = useMemo(() => {
    const rows = new Map<string, ComposioConnectedAccount>()

    for (const account of accounts) {
      const key = normalizeSlug(account.appSlug)

      if (!rows.has(key) || isConnectedStatus(account.status)) {
        rows.set(key, account)
      }
    }

    return rows
  }, [accounts])

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase()

    return apps
      .filter(app => {
        if (!q) {
          return true
        }

        return (
          includesQuery(app.name, q) ||
          includesQuery(app.description, q) ||
          includesQuery(app.slug, q) ||
          app.categories.some(category => includesQuery(category, q)) ||
          (app.sampleTools ?? []).some(tool => includesQuery(tool.name, q) || includesQuery(tool.description, q))
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [apps, query])

  const pageCount = Math.max(1, Math.ceil(filteredApps.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const visibleApps = filteredApps.slice(pageStart, pageStart + pageSize)

  useEffect(() => {
    if (page > pageCount) {
      onPageChange(pageCount)
    }
  }, [onPageChange, page, pageCount])

  async function openConnectLink(app: ComposioApp) {
    setConnectingSlug(app.slug)

    try {
      const result = await initiateComposioConnection(app.slug, composioCallbackUrl())

      if (!result.redirectUrl) {
        throw new Error('Composio did not return a redirect URL.')
      }

      window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')
      notify({
        kind: 'info',
        message: 'Finish authorization in the new tab. You will return here automatically when it completes.',
        title: `${app.name} authorization`
      })
    } catch (err) {
      notifyError(err, `Could not connect ${app.name}`)
    } finally {
      setConnectingSlug(null)
    }
  }

  async function handleConnect(app: ComposioApp) {
    if (!configured) {
      notify({
        kind: 'warning',
        message: 'Add Composio credentials to Verxio API before starting live OAuth flows.',
        title: 'Composio setup required'
      })

      return
    }

    const authMode = resolveAuthMode(app)

    if (authMode === 'requires_oauth_app') {
      notify({
        kind: 'warning',
        message:
          'This integration needs an OAuth app configured in Composio before users can connect. Create a custom auth config in the Composio dashboard.',
        title: 'OAuth app required'
      })

      return
    }

    if (authMode === 'managed_oauth') {
      await openConnectLink(app)

      return
    }

    if (authMode === 'connect_link') {
      setConnectDialogApp(app)
    }
  }

  async function handleInlineConnectSubmit() {
    if (!connectDialogApp) {
      return
    }

    setConnectSubmitting(true)

    try {
      const result = await completeComposioConnection(connectDialogApp.slug, connectValues)
      setConnectDialogApp(null)
      setConnectSetup(null)
      setConnectValues({})
      await refreshConnections()
      notify({
        kind: 'success',
        message: `${connectDialogApp.name} is connected (${result.status}).`,
        title: 'Connection ready'
      })
    } catch (err) {
      notifyError(err, `Could not connect ${connectDialogApp.name}`)
    } finally {
      setConnectSubmitting(false)
    }
  }

  async function handleConnectLinkFallback() {
    if (!connectDialogApp) {
      return
    }

    setConnectLinkLoading(true)

    try {
      await openConnectLink(connectDialogApp)
    } finally {
      setConnectLinkLoading(false)
    }
  }

  async function handleDisconnect(app: ComposioApp, account: ComposioConnectedAccount) {
    setDisconnectingId(account.id)

    try {
      await disconnectComposioAccount(account.id)
      setAccounts(current => current.filter(row => row.id !== account.id))
      notify({ kind: 'success', message: `${app.name} was disconnected.`, title: 'Connection removed' })
    } catch (err) {
      notifyError(err, `Could not disconnect ${app.name}`)
    } finally {
      setDisconnectingId(null)
    }
  }

  return (
    <div className={cn('h-full min-w-0 overflow-y-auto overflow-x-hidden py-3', PAGE_INSET_X)}>
      <div className="min-w-0 space-y-3">
        {message && (
          <div className="flex items-start gap-2 rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-2 text-xs break-words text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-52 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-3.5 animate-spin" />
            Loading connections...
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="grid min-h-52 place-items-center text-center">
            <div>
              <div className="text-sm font-medium">No connections found</div>
              <div className="mt-1 text-xs text-muted-foreground">Try another business app or data source.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleApps.map(app => {
                const account = accountByApp.get(normalizeSlug(app.slug))
                const connected = account ? isConnectedStatus(account.status) : false

                return (
                  <ConnectionCard
                    account={account}
                    app={app}
                    connected={connected}
                    connecting={connectingSlug === app.slug}
                    disconnecting={account ? disconnectingId === account.id : false}
                    key={app.slug}
                    onConnect={() => void handleConnect(app)}
                    onDisconnect={account ? () => void handleDisconnect(app, account) : undefined}
                    onViewTools={() => setToolsDialogApp(app)}
                    setupRequired={!configured}
                  />
                )
              })}
            </div>
            <PaginationControl
              className="pt-2"
              itemLabel="connections"
              onPageChange={onPageChange}
              page={currentPage}
              pageSize={pageSize}
              total={filteredApps.length}
            />
          </>
        )}
      </div>

      <ConnectionToolsDialog
        app={toolsDialogApp}
        error={toolsDialogError}
        loading={toolsDialogLoading}
        onOpenChange={open => {
          if (!open) {
            setToolsDialogApp(null)
            setToolsDialogItems([])
            setToolsDialogError(null)
          }
        }}
        open={Boolean(toolsDialogApp)}
        tools={toolsDialogItems}
      />

      <ConnectionConnectDialog
        app={connectDialogApp}
        error={connectSetupError}
        fallbackLoading={connectLinkLoading}
        loading={connectSetupLoading}
        onFallback={() => void handleConnectLinkFallback()}
        onOpenChange={open => {
          if (!open) {
            setConnectDialogApp(null)
            setConnectSetup(null)
            setConnectSetupError(null)
            setConnectValues({})
          }
        }}
        onSubmit={() => void handleInlineConnectSubmit()}
        onValueChange={(name, value) => {
          setConnectValues(current => ({ ...current, [name]: value }))
        }}
        open={Boolean(connectDialogApp)}
        setup={connectSetup}
        submitting={connectSubmitting}
        values={connectValues}
      />
    </div>
  )
}

interface ConnectionCardProps {
  account?: ComposioConnectedAccount
  app: ComposioApp
  connected: boolean
  connecting: boolean
  disconnecting: boolean
  onConnect: () => void
  onDisconnect?: () => void
  onViewTools: () => void
  setupRequired: boolean
}

function ConnectionCard({
  account,
  app,
  connected,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
  onViewTools,
  setupRequired
}: ConnectionCardProps) {
  const connectable = isAppConnectable(app)
  const disabled = connecting || disconnecting
  const toolCount = app.toolsCount ?? app.sampleTools?.length ?? 0

  return (
    <div className="flex min-h-48 min-w-0 flex-col justify-between rounded-[6px] border border-primary/45 bg-white p-3 text-neutral-950">
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          {app.logoUrl ? (
            <img
              alt=""
              className="size-8 shrink-0 rounded-[5px] border border-primary/20 bg-white object-contain p-1"
              src={app.logoUrl}
            />
          ) : (
            <div className="grid size-8 shrink-0 place-items-center rounded-[5px] bg-primary/10 text-[0.68rem] font-semibold text-primary">
              {initials(app.name)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="truncate text-sm font-medium">{app.name}</div>
              {connected ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <ConnectionStatus account={account} connected={connected} setupRequired={setupRequired} />
              {app.noAuth ? <Badge variant="muted">No auth</Badge> : null}
              {authBadgeLabel(app) ? <Badge variant="muted">{authBadgeLabel(app)}</Badge> : null}
            </div>
          </div>
        </div>
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">
          {app.description || 'Connect this data source for agent actions.'}
        </p>
        {toolCount > 0 ? <div className="mt-2 text-[0.68rem] text-neutral-500">{toolCount} available tools</div> : null}
        {app.categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {app.categories.slice(0, 3).map(category => (
              <span
                className="rounded-[3px] bg-neutral-100 px-1.5 py-0.5 text-[0.65rem] text-neutral-600"
                key={category}
              >
                {category}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
        <Button
          className="w-full min-w-0 sm:w-auto"
          disabled={disabled}
          onClick={onViewTools}
          size="xs"
          type="button"
          variant="outline"
        >
          View tools
        </Button>
        {connected && onDisconnect ? (
          <Button
            className="w-full min-w-0 sm:w-auto"
            disabled={disabled}
            onClick={onDisconnect}
            size="xs"
            type="button"
            variant="outline"
          >
            {disconnecting ? <Loader2 className="size-3 animate-spin" /> : null}
            Disconnect
          </Button>
        ) : (
          <Button
            className="w-full min-w-0 sm:w-auto"
            disabled={disabled || !connectable}
            onClick={onConnect}
            size="xs"
            title={
              connectable
                ? undefined
                : 'Create a custom OAuth app in Composio before users can connect this integration.'
            }
            type="button"
            variant="secondary"
          >
            {connecting ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
            Connect
          </Button>
        )}
      </div>
    </div>
  )
}

function ConnectionToolsDialog({
  app,
  error,
  loading,
  onOpenChange,
  open,
  tools
}: {
  app: ComposioApp | null
  error: string | null
  loading: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
  tools: ComposioToolPreview[]
}) {
  if (!app) {
    return null
  }

  const toolCount = app.toolsCount ?? tools.length

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="box-border w-[calc(100vw-1.5rem)] max-w-xl gap-4 overflow-x-hidden p-4 sm:w-full">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="break-words">{app.name} tools</DialogTitle>
          <DialogDescription className="break-words">
            {toolCount > 0
              ? `${toolCount} tools available through Composio for this integration.`
              : 'Tools available through Composio for this integration.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-32 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-3.5 animate-spin" />
            Loading tools...
          </div>
        ) : error ? (
          <div className="rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-2 text-xs break-words text-muted-foreground">
            {error}
          </div>
        ) : tools.length === 0 ? (
          <div className="text-xs text-muted-foreground">No tools are available for this integration yet.</div>
        ) : (
          <div className="max-h-[min(50vh,28rem)] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
            {tools.map(tool => (
              <div
                className="min-w-0 rounded-[6px] border border-primary/20 bg-white px-3 py-2"
                key={tool.slug || tool.name}
              >
                <div className="text-sm font-medium break-words text-neutral-900">{tool.name}</div>
                {tool.description ? (
                  <div className="mt-1 text-xs leading-5 break-words text-neutral-600">{tool.description}</div>
                ) : null}
                {tool.slug ? (
                  <div className="mt-1 font-mono text-[0.65rem] break-all text-neutral-400">{tool.slug}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConnectionConnectDialog({
  app,
  error,
  fallbackLoading,
  loading,
  onFallback,
  onOpenChange,
  onSubmit,
  onValueChange,
  open,
  setup,
  submitting,
  values
}: {
  app: ComposioApp | null
  error: string | null
  fallbackLoading: boolean
  loading: boolean
  onFallback: () => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  onValueChange: (name: string, value: string) => void
  open: boolean
  setup: ComposioConnectionSetupResponse | null
  submitting: boolean
  values: Record<string, string>
}) {
  if (!app) {
    return null
  }

  const fields = setup?.inputFields ?? []
  const canSubmitInline = setup?.supportsInline && fields.length > 0
  const requiredMissing = fields.some(field => field.required && !values[field.name]?.trim())

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="box-border w-[calc(100vw-1.5rem)] max-w-md gap-4 overflow-x-hidden p-4 sm:w-full">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="break-words">Connect {app.name}</DialogTitle>
          <DialogDescription className="break-words">
            Enter your credentials below to connect without leaving Verxio. Secrets are sent directly to Composio and
            are not stored in Verxio.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-28 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-3.5 animate-spin" />
            Loading connection fields...
          </div>
        ) : error ? (
          <div className="space-y-3">
            <div className="rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-2 text-xs break-words text-muted-foreground">
              {error}
            </div>
            {setup?.supportsLink ? (
              <Button
                className="w-full"
                disabled={fallbackLoading}
                onClick={onFallback}
                type="button"
                variant="outline"
              >
                {fallbackLoading ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
                Continue on Composio instead
              </Button>
            ) : null}
          </div>
        ) : canSubmitInline ? (
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault()
              onSubmit()
            }}
          >
            <div className="space-y-3">
              {fields.map((field: ComposioAuthInputField) => (
                <div className="space-y-1.5" key={field.name}>
                  <label className="text-xs font-medium" htmlFor={`connect-${field.name}`}>
                    {field.displayName}
                    {field.required ? <span className="text-destructive"> *</span> : null}
                  </label>
                  <Input
                    autoComplete="off"
                    id={`connect-${field.name}`}
                    onChange={event => onValueChange(field.name, event.target.value)}
                    placeholder={field.description || field.displayName}
                    spellCheck={false}
                    type={field.isSecret ? 'password' : 'text'}
                    value={values[field.name] ?? ''}
                  />
                  {field.description ? (
                    <p className="text-[0.68rem] leading-5 text-muted-foreground">{field.description}</p>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              {setup?.supportsLink ? (
                <Button disabled={fallbackLoading || submitting} onClick={onFallback} type="button" variant="outline">
                  {fallbackLoading ? <Loader2 className="size-3 animate-spin" /> : null}
                  Use Composio link
                </Button>
              ) : null}
              <Button disabled={submitting || requiredMissing} type="submit" variant="secondary">
                {submitting ? <Loader2 className="size-3 animate-spin" /> : null}
                Connect
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Inline credentials are not available for this integration. Continue on Composio to finish the connection.
            </div>
            {setup?.supportsLink ? (
              <Button
                className="w-full"
                disabled={fallbackLoading}
                onClick={onFallback}
                type="button"
                variant="secondary"
              >
                {fallbackLoading ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
                Continue on Composio
              </Button>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConnectionStatus({
  account,
  connected,
  setupRequired
}: {
  account?: ComposioConnectedAccount
  connected: boolean
  setupRequired: boolean
}) {
  if (connected) {
    return <Badge>Connected</Badge>
  }

  if (account) {
    return <Badge variant="outline">{prettyStatus(account.status)}</Badge>
  }

  return (
    <Badge variant={setupRequired ? 'outline' : 'muted'}>{setupRequired ? 'API key needed' : 'Not connected'}</Badge>
  )
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('')
}

function isConnectedStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()

  return Boolean(normalized && !['deleted', 'disabled', 'disconnected', 'failed', 'inactive'].includes(normalized))
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '')
}

function prettyStatus(status: string): string {
  const normalized = status.trim().replace(/[_-]+/g, ' ')

  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Pending'
}
