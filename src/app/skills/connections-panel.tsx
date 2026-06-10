import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PaginationControl } from '@/components/ui/pagination'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Plug } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  type ComposioApp,
  type ComposioConnectedAccount,
  type ComposioToolPreview,
  disconnectComposioAccount,
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
  const [toolPreviewBySlug, setToolPreviewBySlug] = useState<Map<string, ComposioToolPreview[]>>(() => new Map())

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
    } catch (err) {
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
  const connectedCount = accounts.filter(account => isConnectedStatus(account.status)).length
  const totalTools = filteredApps.reduce((total, app) => total + (app.toolsCount ?? 0), 0)

  useEffect(() => {
    if (page > pageCount) {
      onPageChange(pageCount)
    }
  }, [onPageChange, page, pageCount])

  useEffect(() => {
    const missingApps = visibleApps.filter(app => !app.sampleTools?.length && !toolPreviewBySlug.has(app.slug))

    if (missingApps.length === 0) {
      return
    }

    let cancelled = false

    Promise.all(
      missingApps.map(async app => {
        try {
          const response = await listComposioAppTools(app.slug)

          return [app.slug, response.tools] as const
        } catch {
          return [app.slug, [] as ComposioToolPreview[]] as const
        }
      })
    ).then(results => {
      if (cancelled) {
        return
      }

      setToolPreviewBySlug(current => {
        const next = new Map(current)

        for (const [slug, tools] of results) {
          next.set(slug, tools)
        }

        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [toolPreviewBySlug, visibleApps])

  async function handleConnect(app: ComposioApp) {
    if (!configured) {
      notify({
        kind: 'warning',
        message: 'Add Composio credentials to Verxio API before starting live OAuth flows.',
        title: 'Composio setup required'
      })

      return
    }

    setConnectingSlug(app.slug)

    try {
      const result = await initiateComposioConnection(app.slug)

      if (result.redirectUrl) {
        window.location.href = result.redirectUrl

        return
      }

      await refreshConnections()
      notify({ kind: 'success', message: `${app.name} is available to the agent.`, title: 'Connection ready' })
    } catch (err) {
      notifyError(err, `Could not connect ${app.name}`)
    } finally {
      setConnectingSlug(null)
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
    <div className={cn('h-full overflow-y-auto py-3', PAGE_INSET_X)}>
      <div className="space-y-3">
        <div className="grid gap-2 lg:grid-cols-3">
          <ConnectionMetric label="Connected" value={String(connectedCount)} />
          <ConnectionMetric label="Toolkits" value={`${filteredApps.length} apps`} />
          <ConnectionMetric label="Tools" value={totalTools > 0 ? `${totalTools}+` : 'Previews'} />
          <ConnectionMetric label="Runtime" value="Composio MCP" />
        </div>

        {message && (
          <div className="flex items-start gap-2 rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-3 py-2 text-xs text-muted-foreground">
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
            <div className="grid gap-2 lg:grid-cols-3">
              {visibleApps.map(app => {
                const account = accountByApp.get(normalizeSlug(app.slug))
                const connected = account ? isConnectedStatus(account.status) : false
                const tools = app.sampleTools?.length ? app.sampleTools : toolPreviewBySlug.get(app.slug) || []

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
                    setupRequired={!configured}
                    tools={tools}
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
    </div>
  )
}

function ConnectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-primary/40 bg-white px-3 py-2 text-neutral-950">
      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
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
  setupRequired: boolean
  tools: ComposioToolPreview[]
}

function ConnectionCard({
  account,
  app,
  connected,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
  setupRequired,
  tools
}: ConnectionCardProps) {
  const disabled = connecting || disconnecting

  const toolsLabel = app.toolsCount
    ? `${app.toolsCount} tools`
    : tools.length
      ? `${tools.length} tool previews`
      : 'Tools'

  return (
    <div className="flex min-h-64 flex-col justify-between rounded-[6px] border border-primary/45 bg-white p-3 text-neutral-950">
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
            </div>
          </div>
        </div>
        <p className="mt-3 max-h-10 overflow-hidden text-xs leading-5 text-muted-foreground">
          {app.description || 'Connect this data source for agent actions.'}
        </p>
        <div className="mt-3 rounded-[5px] border border-primary/25 bg-white px-2 py-2">
          <div className="mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-neutral-500">
            {toolsLabel}
          </div>
          {tools.length > 0 ? (
            <div className="space-y-1.5">
              {tools.slice(0, 3).map(tool => (
                <div className="min-w-0" key={tool.slug || tool.name}>
                  <div className="truncate text-[0.72rem] font-medium text-neutral-800">{tool.name}</div>
                  {tool.description ? (
                    <div className="line-clamp-2 text-[0.68rem] leading-4 text-neutral-500">{tool.description}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[0.68rem] leading-4 text-neutral-500">
              Tool preview loads from Composio when the API key is available.
            </div>
          )}
        </div>
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

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[0.65rem] text-neutral-500">
          <Plug className="size-3" />
          Agent tools
        </div>
        {connected && onDisconnect ? (
          <Button disabled={disabled} onClick={onDisconnect} size="xs" type="button" variant="outline">
            {disconnecting ? <Loader2 className="size-3 animate-spin" /> : null}
            Disconnect
          </Button>
        ) : (
          <Button disabled={disabled} onClick={onConnect} size="xs" type="button" variant="secondary">
            {connecting ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
            Connect
          </Button>
        )}
      </div>
    </div>
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
