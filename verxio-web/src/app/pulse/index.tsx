import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageSearchShell } from '@/app/page-search-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  BarChart3,
  Brain,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Users,
  Zap
} from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  completePulseMetaOAuth,
  connectPulseChannel,
  createPulseAutomation,
  generatePulseAutomation,
  getPulseAnalytics,
  getPulseConversation,
  listPulseAutomations,
  listPulseChannels,
  listPulseConversations,
  type PulseAnalyticsResponse,
  type PulseAutomation,
  type PulseChannelCapabilityMatrixItem,
  type PulseChannelType,
  type PulseConversation,
  type PulseConversationDetailResponse,
  type PulseFlowDefinition,
  type PulseMessage,
  sendPulseMessage,
  simulatePulseAutomation,
  togglePulseAutomation,
  updatePulseConversationState
} from '@/lib/verxio-api'

import type { StatusbarItem } from '../shell/statusbar-controls'

type PulseTab = 'overview' | 'inbox' | 'automations' | 'builder' | 'channels' | 'settings'

interface PulseViewProps {
  setStatusbarItemGroup?: (id: string, items: StatusbarItem[]) => void
}

const PULSE_TABS: PulseTab[] = ['overview', 'inbox', 'automations', 'builder', 'channels', 'settings']

const CHANNELS: PulseChannelType[] = ['instagram', 'messenger', 'whatsapp', 'tiktok', 'linkedin']

const DEFAULT_FLOW: PulseFlowDefinition = {
  nodes: [
    {
      id: 'trigger-1',
      kind: 'trigger',
      label: 'Keyword trigger',
      config: { trigger: 'comment_keyword', keywords: ['info', 'price', 'demo'] }
    },
    {
      id: 'ai-1',
      kind: 'ai_reply',
      label: 'AI qualification reply',
      config: { goal: 'Answer the lead and qualify purchase intent.', allowComposio: true }
    },
    { id: 'tag-1', kind: 'set_tag', label: 'Tag lead', config: { tag: 'pulse-lead' } },
    { id: 'end-1', kind: 'end', label: 'Done', config: {} }
  ],
  edges: [
    { id: 'edge-1', source: 'trigger-1', target: 'ai-1' },
    { id: 'edge-2', source: 'ai-1', target: 'tag-1' },
    { id: 'edge-3', source: 'tag-1', target: 'end-1' }
  ]
}

export function PulseView({ setStatusbarItemGroup }: PulseViewProps) {
  const { t } = useI18n()
  const p = t.pulse
  const [searchParams, setSearchParams] = useSearchParams()

  const tab = PULSE_TABS.includes(searchParams.get('tab') as PulseTab)
    ? (searchParams.get('tab') as PulseTab)
    : 'overview'

  const selectedConversationId = searchParams.get('conversation')

  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof listPulseChannels>>['channels']>([])
  const [capabilityMatrix, setCapabilityMatrix] = useState<PulseChannelCapabilityMatrixItem[]>([])
  const [conversations, setConversations] = useState<PulseConversation[]>([])
  const [conversationDetail, setConversationDetail] = useState<PulseConversationDetailResponse | null>(null)
  const [automations, setAutomations] = useState<PulseAutomation[]>([])
  const [analytics, setAnalytics] = useState<PulseAnalyticsResponse | null>(null)
  const [reply, setReply] = useState('')
  const [automationName, setAutomationName] = useState('Instagram comment-to-DM lead capture')

  const [builderPrompt, setBuilderPrompt] = useState(
    'When someone comments "price", send a helpful DM, qualify the lead, tag them, and log the lead with Composio.'
  )

  const [simulation, setSimulation] = useState<PulseMessage[]>([])
  const [whatsappPhoneId, setWhatsappPhoneId] = useState('')
  const [whatsappToken, setWhatsappToken] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [channelData, conversationData, automationData, analyticsData] = await Promise.all([
        listPulseChannels(),
        listPulseConversations(),
        listPulseAutomations(),
        getPulseAnalytics()
      ])

      setChannels(channelData.channels)
      setCapabilityMatrix(channelData.capabilityMatrix)
      setConversations(conversationData.conversations)
      setAutomations(automationData.automations)
      setAnalytics(analyticsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : p.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [p.loadFailed])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setStatusbarItemGroup?.('pulse', [
      {
        id: 'pulse-status',
        icon: <MessageCircle aria-hidden className="size-3" />,
        label: `${channels.length} Pulse channel${channels.length === 1 ? '' : 's'}`
      }
    ])

    return () => setStatusbarItemGroup?.('pulse', [])
  }, [channels.length, setStatusbarItemGroup])

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code || !state?.startsWith('pulse:')) {
      return
    }

    const channelType = state.split(':')[3] as PulseChannelType | undefined

    if (!channelType) {
      return
    }

    const redirectUri = `${window.location.origin}${window.location.pathname}?tab=channels`
    setBusyAction('meta-complete')
    completePulseMetaOAuth(code, redirectUri, channelType)
      .then(result => {
        setNotice(result.message)
        setSearchParams({ tab: 'channels' }, { replace: true })

        return refresh()
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Meta OAuth failed.'))
      .finally(() => setBusyAction(null))
  }, [refresh, searchParams, setSearchParams])

  useEffect(() => {
    if (!selectedConversationId) {
      setConversationDetail(null)

      return
    }

    let cancelled = false
    getPulseConversation(selectedConversationId)
      .then(detail => {
        if (!cancelled) {
          setConversationDetail(detail)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load conversation.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedConversationId])

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return conversations
    }

    return conversations.filter(item =>
      [item.contact_name, item.channel_name, item.last_message ?? ''].some(value => value.toLowerCase().includes(query))
    )
  }, [conversations, search])

  const filteredAutomations = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return automations
    }

    return automations.filter(item => item.name.toLowerCase().includes(query))
  }, [automations, search])

  const selectTab = (nextTab: PulseTab) => {
    setSearchParams(params => {
      params.set('tab', nextTab)

      if (nextTab !== 'inbox') {
        params.delete('conversation')
      }

      return params
    })
  }

  const selectConversation = (conversationId: string) => {
    setSearchParams(params => {
      params.set('tab', 'inbox')
      params.set('conversation', conversationId)

      return params
    })
  }

  const connectMeta = async (channelType: 'instagram' | 'messenger') => {
    setBusyAction(channelType)
    setError(null)

    try {
      const redirectUri = `${window.location.origin}${window.location.pathname}?tab=channels`
      const result = await connectPulseChannel(channelType, { callbackUrl: redirectUri })

      if (result.redirectUrl) {
        window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')
      }

      setNotice(result.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start channel connection.')
    } finally {
      setBusyAction(null)
    }
  }

  const connectWhatsApp = async () => {
    setBusyAction('whatsapp')
    setError(null)

    try {
      const result = await connectPulseChannel('whatsapp', {
        display_name: 'WhatsApp Business',
        external_id: whatsappPhoneId,
        credentials: { access_token: whatsappToken, phone_number_id: whatsappPhoneId }
      })

      setNotice(result.message)
      setWhatsappPhoneId('')
      setWhatsappToken('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect WhatsApp.')
    } finally {
      setBusyAction(null)
    }
  }

  const createDefaultAutomation = async () => {
    setBusyAction('create-automation')

    try {
      const created = await createPulseAutomation({
        channel_type: 'instagram',
        enabled: false,
        flow: DEFAULT_FLOW,
        name: automationName
      })

      setAutomations(items => [created, ...items])
      setNotice('Automation created.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create automation.')
    } finally {
      setBusyAction(null)
    }
  }

  const generateFlow = async () => {
    setBusyAction('generate')

    try {
      const generated = await generatePulseAutomation(builderPrompt, 'instagram')
      setAutomationName(generated.name)
      setSimulation([])
      setNotice('Generated a Pulse flow draft.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate flow.')
    } finally {
      setBusyAction(null)
    }
  }

  const simulateFlow = async (automationId?: string) => {
    setBusyAction('simulate')

    try {
      const result = await simulatePulseAutomation({
        automation_id: automationId,
        flow: automationId ? undefined : DEFAULT_FLOW,
        message: 'price'
      })

      setSimulation(result.transcript)
      setNotice('Simulation complete.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not simulate automation.')
    } finally {
      setBusyAction(null)
    }
  }

  const sendReply = async () => {
    if (!selectedConversationId || !reply.trim()) {
      return
    }

    setBusyAction('reply')

    try {
      const sent = await sendPulseMessage(selectedConversationId, reply.trim())
      setConversationDetail(detail => (detail ? { ...detail, messages: [...detail.messages, sent] } : detail))
      setReply('')
      setNotice('Reply queued.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reply.')
    } finally {
      setBusyAction(null)
    }
  }

  const setConversationState = async (state: 'automated' | 'human') => {
    if (!selectedConversationId) {
      return
    }

    setBusyAction(`state-${state}`)

    try {
      const updated = await updatePulseConversationState(selectedConversationId, state)
      setConversationDetail(detail => (detail ? { ...detail, conversation: updated } : detail))
      setConversations(items => items.map(item => (item.id === updated.id ? updated : item)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update conversation state.')
    } finally {
      setBusyAction(null)
    }
  }

  const tabs = (
    <div className="flex flex-wrap items-center gap-1">
      {PULSE_TABS.map(item => (
        <button
          className={cn(
            'h-8 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            item === tab
              ? 'bg-(--ui-row-active-background) text-(--ui-text-primary)'
              : 'text-(--ui-text-secondary) hover:bg-(--ui-row-hover-background) hover:text-(--ui-text-primary)'
          )}
          key={item}
          onClick={() => selectTab(item)}
          type="button"
        >
          {p.tabs[item]}
        </button>
      ))}
    </div>
  )

  return (
    <PageSearchShell onSearchChange={setSearch} searchPlaceholder={p.search} searchValue={search} tabs={tabs}>
      <div className="h-full overflow-auto px-4 pb-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <header className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-primary/10 p-2 text-primary">
                    <Zap aria-hidden className="size-4" />
                  </span>
                  <h1 className="text-lg font-semibold text-(--ui-text-primary)">{p.title}</h1>
                  <Badge>Hermes + Composio</Badge>
                </div>
                <p className="max-w-3xl text-sm text-(--ui-text-secondary)">{p.subtitle}</p>
              </div>
              <Button onClick={() => selectTab('channels')} size="sm">
                <Plus aria-hidden className="size-4" />
                {p.empty.action}
              </Button>
            </div>
          </header>

          {notice && (
            <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <LoadingState />
          ) : tab === 'overview' ? (
            <Overview analytics={analytics} channels={channels.length} conversations={conversations} copy={p} />
          ) : tab === 'inbox' ? (
            <InboxTab
              busyAction={busyAction}
              conversations={filteredConversations}
              copy={p}
              detail={conversationDetail}
              onSelectConversation={selectConversation}
              onSendReply={sendReply}
              onSetState={setConversationState}
              reply={reply}
              setReply={setReply}
            />
          ) : tab === 'automations' ? (
            <AutomationsTab
              automations={filteredAutomations}
              busyAction={busyAction}
              copy={p}
              name={automationName}
              onCreate={createDefaultAutomation}
              onNameChange={setAutomationName}
              onSimulate={simulateFlow}
              onToggle={async automation => {
                const updated = await togglePulseAutomation(automation.id, !automation.enabled)
                setAutomations(items => items.map(item => (item.id === updated.id ? updated : item)))
              }}
            />
          ) : tab === 'builder' ? (
            <BuilderTab
              busyAction={busyAction}
              copy={p}
              onGenerate={generateFlow}
              onPromptChange={setBuilderPrompt}
              onSimulate={() => simulateFlow()}
              prompt={builderPrompt}
              simulation={simulation}
            />
          ) : tab === 'channels' ? (
            <ChannelsTab
              busyAction={busyAction}
              channels={channels}
              copy={p}
              matrix={capabilityMatrix}
              onConnectMeta={connectMeta}
              onConnectWhatsApp={connectWhatsApp}
              setWhatsappPhoneId={setWhatsappPhoneId}
              setWhatsappToken={setWhatsappToken}
              whatsappPhoneId={whatsappPhoneId}
              whatsappToken={whatsappToken}
            />
          ) : (
            <SettingsTab copy={p} />
          )}
        </div>
      </div>
    </PageSearchShell>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton className="h-28 rounded-lg" key={index} />
      ))}
    </div>
  )
}

function Overview({
  analytics,
  channels,
  conversations,
  copy
}: {
  analytics: PulseAnalyticsResponse | null
  channels: number
  conversations: PulseConversation[]
  copy: ReturnType<typeof useI18n>['t']['pulse']
}) {
  const totals = analytics?.totals ?? {}

  const cards = [
    { icon: MessageCircle, label: copy.stats.channels, value: channels },
    { icon: Users, label: copy.stats.contacts, value: totals.contacts ?? 0 },
    { icon: BarChart3, label: copy.stats.conversations, value: totals.conversations ?? conversations.length },
    { icon: Sparkles, label: copy.stats.automations, value: totals.automations ?? 0 }
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => (
        <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4" key={card.label}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-(--ui-text-secondary)">{card.label}</span>
            <card.icon aria-hidden className="size-4 text-primary" />
          </div>
          <div className="mt-3 text-2xl font-semibold text-(--ui-text-primary)">{card.value}</div>
        </div>
      ))}
    </div>
  )
}

function InboxTab({
  busyAction,
  conversations,
  detail,
  onSelectConversation,
  onSendReply,
  onSetState,
  reply,
  setReply,
  copy
}: {
  busyAction: string | null
  conversations: PulseConversation[]
  detail: PulseConversationDetailResponse | null
  onSelectConversation: (id: string) => void
  onSendReply: () => void
  onSetState: (state: 'automated' | 'human') => void
  reply: string
  setReply: (value: string) => void
  copy: ReturnType<typeof useI18n>['t']['pulse']
}) {
  return (
    <div className="grid min-h-128 gap-3 lg:grid-cols-[20rem_1fr]">
      <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary)">
        <div className="border-b border-(--ui-stroke-secondary) p-3 text-sm font-medium">{copy.inbox.title}</div>
        <div className="divide-y divide-(--ui-stroke-secondary)">
          {conversations.length ? (
            conversations.map(conversation => (
              <button
                className="flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-(--ui-row-hover-background) focus-visible:ring-2 focus-visible:ring-ring"
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                type="button"
              >
                <span className="text-sm font-medium text-(--ui-text-primary)">{conversation.contact_name}</span>
                <span className="line-clamp-1 text-xs text-(--ui-text-secondary)">
                  {conversation.last_message || conversation.channel_name}
                </span>
              </button>
            ))
          ) : (
            <EmptyCard description={copy.empty.description} title={copy.empty.title} />
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-col rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary)">
        {detail ? (
          <>
            <div className="flex items-center justify-between border-b border-(--ui-stroke-secondary) p-3">
              <div>
                <div className="text-sm font-medium">{detail.contact.display_name}</div>
                <div className="text-xs text-(--ui-text-secondary)">{detail.conversation.channel_name}</div>
              </div>
              <Button
                onClick={() => onSetState(detail.conversation.state === 'human' ? 'automated' : 'human')}
                size="sm"
                variant="secondary"
              >
                {detail.conversation.state === 'human' ? copy.inbox.resume : copy.inbox.takeover}
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
              {detail.messages.map(message => (
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                    message.direction === 'outbound'
                      ? 'ml-auto bg-primary/10 text-(--ui-text-primary)'
                      : 'bg-(--ui-bg-secondary) text-(--ui-text-primary)'
                  )}
                  key={message.id}
                >
                  {message.body}
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t border-(--ui-stroke-secondary) p-3">
              <Input
                onChange={event => setReply(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    onSendReply()
                  }
                }}
                placeholder={copy.inbox.messagePlaceholder}
                value={reply}
              />
              <Button disabled={!reply.trim() || busyAction === 'reply'} onClick={onSendReply} size="icon">
                <Send aria-hidden className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <EmptyCard description={copy.empty.description} title={copy.inbox.noConversation} />
        )}
      </div>
    </div>
  )
}

function AutomationsTab({
  automations,
  busyAction,
  copy,
  name,
  onCreate,
  onNameChange,
  onSimulate,
  onToggle
}: {
  automations: PulseAutomation[]
  busyAction: string | null
  copy: ReturnType<typeof useI18n>['t']['pulse']
  name: string
  onCreate: () => void
  onNameChange: (value: string) => void
  onSimulate: (id?: string) => void
  onToggle: (automation: PulseAutomation) => Promise<void>
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[24rem_1fr]">
      <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4">
        <h2 className="text-sm font-semibold">{copy.automations.newAutomation}</h2>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-(--ui-text-secondary)" htmlFor="pulse-automation-name">
            Name
          </label>
          <Input id="pulse-automation-name" onChange={event => onNameChange(event.target.value)} value={name} />
          <Button disabled={busyAction === 'create-automation'} onClick={onCreate} size="sm">
            <Plus aria-hidden className="size-4" />
            {copy.automations.newAutomation}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {automations.length ? (
          automations.map(automation => (
            <div
              className="flex flex-col gap-3 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4 md:flex-row md:items-center md:justify-between"
              key={automation.id}
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">{automation.name}</h3>
                  <Badge variant={automation.enabled ? 'default' : 'muted'}>
                    {automation.enabled ? copy.automations.enabled : copy.automations.disabled}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-(--ui-text-secondary)">
                  {automation.channel_type} · {automation.flow.nodes.length} nodes · v{automation.version}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => onSimulate(automation.id)} size="sm" variant="secondary">
                  {copy.automations.simulate}
                </Button>
                <Button onClick={() => void onToggle(automation)} size="sm" variant="outline">
                  {automation.enabled ? copy.automations.disabled : copy.automations.enabled}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <EmptyCard description={copy.empty.description} title={copy.empty.title} />
        )}
      </div>
    </div>
  )
}

function BuilderTab({
  busyAction,
  copy,
  onGenerate,
  onPromptChange,
  onSimulate,
  prompt,
  simulation
}: {
  busyAction: string | null
  copy: ReturnType<typeof useI18n>['t']['pulse']
  onGenerate: () => void
  onPromptChange: (value: string) => void
  onSimulate: () => void
  prompt: string
  simulation: PulseMessage[]
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_24rem]">
      <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4">
        <div className="flex items-center gap-2">
          <Brain aria-hidden className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{copy.builder.title}</h2>
        </div>
        <Textarea
          className="mt-3 min-h-40"
          onChange={event => onPromptChange(event.target.value)}
          placeholder={copy.builder.promptPlaceholder}
          value={prompt}
        />
        <div className="mt-3 flex gap-2">
          <Button disabled={busyAction === 'generate'} onClick={onGenerate} size="sm">
            <Sparkles aria-hidden className="size-4" />
            {copy.builder.generate}
          </Button>
          <Button disabled={busyAction === 'simulate'} onClick={onSimulate} size="sm" variant="secondary">
            {copy.builder.simulator}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4">
        <h3 className="text-sm font-semibold">{copy.builder.simulator}</h3>
        <div className="mt-3 space-y-2">
          {simulation.length ? (
            simulation.map(message => (
              <div className="rounded-md bg-(--ui-bg-secondary) p-3 text-sm" key={message.id}>
                <Badge variant={message.direction === 'outbound' ? 'default' : 'outline'}>{message.direction}</Badge>
                <p className="mt-2">{message.body}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-(--ui-text-secondary)">Run a simulation to preview the first turns.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ChannelsTab({
  busyAction,
  channels,
  copy,
  matrix,
  onConnectMeta,
  onConnectWhatsApp,
  setWhatsappPhoneId,
  setWhatsappToken,
  whatsappPhoneId,
  whatsappToken
}: {
  busyAction: string | null
  channels: Awaited<ReturnType<typeof listPulseChannels>>['channels']
  copy: ReturnType<typeof useI18n>['t']['pulse']
  matrix: PulseChannelCapabilityMatrixItem[]
  onConnectMeta: (channel: 'instagram' | 'messenger') => void
  onConnectWhatsApp: () => void
  setWhatsappPhoneId: (value: string) => void
  setWhatsappToken: (value: string) => void
  whatsappPhoneId: string
  whatsappToken: string
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {CHANNELS.map(channel => {
        const meta = matrix.find(item => item.channel_type === channel)
        const connected = channels.some(item => item.channel_type === channel)

        return (
          <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4" key={channel}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{meta?.name ?? channel}</h2>
                  <Badge variant={connected ? 'default' : meta?.tier === 'first_class' ? 'outline' : 'warn'}>
                    {connected
                      ? copy.channels.connected
                      : meta?.tier === 'first_class'
                        ? 'Official'
                        : copy.channels.gated}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-(--ui-text-secondary)">{meta?.description}</p>
              </div>
              {meta?.docsUrl && (
                <a
                  className="inline-flex size-10 items-center justify-center rounded-md text-(--ui-text-secondary) hover:bg-(--ui-row-hover-background) focus-visible:ring-2 focus-visible:ring-ring"
                  href={meta.docsUrl}
                  rel="noreferrer"
                  target="_blank"
                  title={copy.channels.docs}
                >
                  <ExternalLink aria-hidden className="size-4" />
                </a>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {meta?.capabilities.map(capability => (
                <Badge key={capability.key} variant={capability.supported ? 'default' : 'muted'}>
                  {capability.supported ? <CheckCircle2 aria-hidden className="size-3" /> : null}
                  {capability.label}
                </Badge>
              ))}
            </div>
            {channel === 'instagram' || channel === 'messenger' ? (
              <Button
                className="mt-4"
                disabled={busyAction === channel}
                onClick={() => onConnectMeta(channel)}
                size="sm"
                variant={connected ? 'secondary' : 'default'}
              >
                {copy.channels.connect} {meta?.name}
              </Button>
            ) : channel === 'whatsapp' ? (
              <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label="WhatsApp phone number ID"
                  onChange={event => setWhatsappPhoneId(event.target.value)}
                  placeholder="Phone number ID"
                  value={whatsappPhoneId}
                />
                <Input
                  aria-label="WhatsApp access token"
                  onChange={event => setWhatsappToken(event.target.value)}
                  placeholder="Cloud API access token"
                  type="password"
                  value={whatsappToken}
                />
                <Button
                  disabled={!whatsappPhoneId.trim() || !whatsappToken.trim() || busyAction === 'whatsapp'}
                  onClick={onConnectWhatsApp}
                  size="sm"
                >
                  {copy.channels.connect}
                </Button>
              </div>
            ) : (
              <p className="mt-4 text-sm text-(--ui-text-secondary)">
                Official access is gated. Pulse will enable this card when approved API credentials are available.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SettingsTab({ copy }: { copy: ReturnType<typeof useI18n>['t']['pulse'] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {[copy.settings.businessProfile, copy.settings.brandVoice, copy.settings.guardrails].map(item => (
        <div className="rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4" key={item}>
          <h2 className="text-sm font-semibold">{item}</h2>
          <p className="mt-2 text-sm text-(--ui-text-secondary)">
            Configure this before enabling AI nodes so Pulse replies match your business and channel policies.
          </p>
          <Button className="mt-4" size="sm" variant="secondary">
            {copy.channels.connect}
          </Button>
        </div>
      ))}
    </div>
  )
}

function EmptyCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg p-6 text-center">
      <MessageCircle aria-hidden className="size-8 text-primary" />
      <h2 className="mt-3 text-sm font-semibold text-(--ui-text-primary)">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-(--ui-text-secondary)">{description}</p>
    </div>
  )
}
