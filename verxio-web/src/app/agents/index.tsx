import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { PageLoader } from '@/components/page-loader'
import { SkillEditorDialog } from '@/components/skill-editor-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { PaginationControl } from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { VerxioWordmark } from '@/components/verxio-wordmark'
import { AlertCircle, CheckCircle2, ChevronLeft, Plus, RefreshCw, Save, Send, Sparkles, Trash2, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  createKnowledgeBase,
  createKnowledgeDocument,
  createWorkflowAgent,
  createWorkflowCustomTool,
  createWorkflowDelivery,
  createWorkflowTrigger,
  deleteKnowledgeBase,
  deleteWorkflowAgent,
  deleteWorkflowDelivery,
  deleteWorkflowTrigger,
  draftWorkflowAgentSetup,
  draftWorkflowAgentSetupUpdate,
  getPublicWorkflowAgent,
  getWorkflowAgentEmbedConfig,
  type KnowledgeBase,
  listKnowledgeBases,
  listWorkflowAgents,
  listWorkflowDeliveries,
  listWorkflowIntegrationCapabilities,
  listWorkflowRunEvents,
  listWorkflowRuns,
  listWorkflowSkillCapabilities,
  listWorkflowToolCapabilities,
  listWorkflowTriggers,
  runPublicWorkflowAgent,
  runWorkflowAgent,
  updateWorkflowAgent,
  updateWorkflowAgentEmbedConfig,
  updateWorkflowDelivery,
  updateWorkflowTrigger,
  uploadWorkflowAgentEmbedAsset,
  type WorkflowAgent,
  type WorkflowAgentEmbedConfig,
  type WorkflowAgentPublicInfo,
  type WorkflowAgentSetupDraft,
  type WorkflowAgentSetupDraftResponse,
  type WorkflowDelivery,
  type WorkflowDeliveryType,
  type WorkflowIntegrationCapability,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowSkillCapability,
  type WorkflowToolCapability,
  type WorkflowTrigger,
  type WorkflowTriggerType
} from '@/lib/verxio-api'
import { getScopedModelOptions } from '@/lib/verxio-model-options'
import { notify, notifyError } from '@/store/notifications'

import { AGENTS_ROUTE, SETTINGS_ROUTE } from '../routes'

type AgentTab =
  | 'instructions'
  | 'skills'
  | 'knowledge'
  | 'integrations'
  | 'tools'
  | 'delivery'
  | 'triggers'
  | 'embed'
  | 'runs'

const AGENT_TABS: Array<{ id: AgentTab; label: string }> = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'skills', label: 'Skills' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'tools', label: 'Tools' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'embed', label: 'Embed' },
  { id: 'runs', label: 'Runs' }
]

const TRIGGER_TYPES: WorkflowTriggerType[] = ['manual', 'webhook', 'schedule', 'api', 'app_event', 'chat']

type TriggerSourceId = 'app_event' | 'embed' | 'manual' | 'messaging' | 'schedule' | 'webhook'

const TRIGGER_SOURCES: Array<{
  config: Record<string, unknown>
  description: string
  eventName: string
  id: TriggerSourceId
  name: string
  title: string
  triggerType: WorkflowTriggerType
}> = [
  {
    config: { version: 1 },
    description: 'Start from the Run button or a direct in-app test.',
    eventName: 'manual.run',
    id: 'manual',
    name: 'Manual run',
    title: 'Manual',
    triggerType: 'manual'
  },
  {
    config: { version: 1 },
    description: 'Receive JSON from payments, forms, backend APIs, or external systems.',
    eventName: 'external.event',
    id: 'webhook',
    name: 'External webhook',
    title: 'Webhook/API',
    triggerType: 'webhook'
  },
  {
    config: { everyMinutes: 60, version: 1 },
    description: 'Run on an interval or cron-like schedule.',
    eventName: 'scheduled.run',
    id: 'schedule',
    name: 'Scheduled run',
    title: 'Schedule',
    triggerType: 'schedule'
  },
  {
    config: { appSlug: 'hubspot', event: 'lead.created', version: 1 },
    description: 'Start from a connected Composio app event such as CRM, email, or forms.',
    eventName: 'lead.created',
    id: 'app_event',
    name: 'Connected app event',
    title: 'Connected app',
    triggerType: 'app_event'
  },
  {
    config: { channel: 'whatsapp', enabledWhenGatewayConnected: true, version: 1 },
    description: 'Start from WhatsApp, Telegram, Slack, Discord, or email inbound messages.',
    eventName: 'message.received',
    id: 'messaging',
    name: 'Messaging gateway',
    title: 'Messaging gateway',
    triggerType: 'chat'
  },
  {
    config: { source: 'embed', enabledWhenEmbedConfigured: true, version: 1 },
    description: 'Start when a website widget or share page submits input.',
    eventName: 'embed.submitted',
    id: 'embed',
    name: 'Embed or share form',
    title: 'Embed/share',
    triggerType: 'api'
  }
]

const DELIVERY_TYPES: WorkflowDeliveryType[] = [
  'save_only',
  'reply_to_source',
  'send_message',
  'composio_action',
  'webhook_callback',
  'approval_first'
]

const AGENT_PAGE_SIZE = 8
const PANEL_PAGE_SIZE = 6
const AGENT_DRAFT_ROUTE_SEGMENT = 'drafts'

interface DraftState {
  approval_policy: string
  description: string
  enabled: boolean
  instructions: string
  integrationsText: string
  knowledgeText: string
  model_id: string
  name: string
  role: string
  skillsText: string
  toolsText: string
}

function draftFromAgent(agent?: WorkflowAgent | null): DraftState {
  return {
    approval_policy: agent?.approval_policy ?? 'default',
    description: agent?.description ?? '',
    enabled: agent?.enabled ?? true,
    instructions: agent?.instructions ?? '',
    integrationsText: (agent?.integrations ?? []).join('\n'),
    knowledgeText: (agent?.knowledge ?? []).join('\n'),
    model_id: agent?.model_id ?? '',
    name: agent?.name ?? '',
    role: agent?.role ?? '',
    skillsText: (agent?.skills ?? []).join('\n'),
    toolsText: (agent?.tools ?? []).join('\n')
  }
}

function draftFromSetupDraft(setupDraft: WorkflowAgentSetupDraft, defaultModelId = ''): DraftState {
  const agent = setupDraft.draft.agent

  return {
    approval_policy: agent.approval_policy ?? 'default',
    description: agent.description ?? '',
    enabled: agent.enabled ?? true,
    instructions: agent.instructions ?? '',
    integrationsText: (agent.integrations ?? []).join('\n'),
    knowledgeText: (agent.knowledge ?? []).join('\n'),
    model_id: agent.model_id || defaultModelId,
    name: agent.name ?? '',
    role: agent.role ?? '',
    skillsText: (agent.skills ?? []).join('\n'),
    toolsText: (agent.tools ?? []).join('\n')
  }
}

interface AgentListItem {
  agent?: WorkflowAgent
  draft?: WorkflowAgentSetupDraft
  id: string
  timestamp: string
  type: 'agent' | 'draft'
}

interface AgentModelOption {
  id: string
  label: string
  provider: string
}

type AgentRouteSelection =
  | { id: string; kind: 'agent' }
  | { id: string; kind: 'draft' }
  | { kind: 'list' }
  | { kind: 'new' }

type ToolCatalogMode = 'default' | 'custom' | 'add'

interface CustomToolDraft {
  api_key_env: string
  auth_type: 'api_key' | 'bearer' | 'none'
  description: string
  method: string
  name: string
  request_schema: string
  response_hint: string
  url: string
}

const emptyCustomToolDraft = (): CustomToolDraft => ({
  api_key_env: '',
  auth_type: 'api_key',
  description: '',
  method: 'POST',
  name: '',
  request_schema: '{\n  "type": "object",\n  "properties": {}\n}',
  response_hint: '',
  url: ''
})

function agentDetailRoute(agentId: string): string {
  return `${AGENTS_ROUTE}/${encodeURIComponent(agentId)}`
}

function agentDraftRoute(setupDraftId: string): string {
  return `${AGENTS_ROUTE}/${AGENT_DRAFT_ROUTE_SEGMENT}/${encodeURIComponent(setupDraftId)}`
}

function parseAgentRoute(pathname: string): AgentRouteSelection {
  const parts = pathname.split('/').filter(Boolean)

  if (parts[0] !== 'agents') {
    return { kind: 'list' }
  }

  if (parts.length === 1) {
    return { kind: 'list' }
  }

  if (parts[1] === 'new') {
    return { kind: 'new' }
  }

  if (parts[1] === AGENT_DRAFT_ROUTE_SEGMENT && parts[2]) {
    return { id: decodeURIComponent(parts[2]), kind: 'draft' }
  }

  return { id: decodeURIComponent(parts[1]), kind: 'agent' }
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)

    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.left = '-9999px'
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Browser clipboard copy failed.')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

function lines(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map(item => item.trim())
        .filter(Boolean)
    )
  )
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'Not yet'
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function AgentsView() {
  const location = useLocation()
  const navigate = useNavigate()
  const [agents, setAgents] = useState<WorkflowAgent[]>([])
  const [setupDrafts, setSetupDrafts] = useState<WorkflowAgentSetupDraft[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<DraftState>(() => draftFromAgent())
  const [deliveries, setDeliveries] = useState<WorkflowDelivery[]>([])
  const [triggers, setTriggers] = useState<WorkflowTrigger[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [embedConfig, setEmbedConfig] = useState<WorkflowAgentEmbedConfig | null>(null)
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [integrationCapabilities, setIntegrationCapabilities] = useState<WorkflowIntegrationCapability[]>([])
  const [integrationCapabilityErrors, setIntegrationCapabilityErrors] = useState<string[]>([])
  const [skillCapabilities, setSkillCapabilities] = useState<WorkflowSkillCapability[]>([])
  const [skillCapabilityErrors, setSkillCapabilityErrors] = useState<string[]>([])
  const [toolCapabilities, setToolCapabilities] = useState<WorkflowToolCapability[]>([])
  const [toolCapabilityErrors, setToolCapabilityErrors] = useState<string[]>([])
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([])
  const [defaultModelId, setDefaultModelId] = useState('')
  const [modelErrors, setModelErrors] = useState<string[]>([])
  const [tab, setTab] = useState<AgentTab>('instructions')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setupDraftResponse, setSetupDraftResponse] = useState<WorkflowAgentSetupDraftResponse | null>(null)
  const [setupPrompt, setSetupPrompt] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)
  const routeSelection = useMemo(() => parseAgentRoute(location.pathname), [location.pathname])

  const selected = useMemo(() => agents.find(agent => agent.id === selectedId) ?? null, [agents, selectedId])

  const selectedSetupDraft = useMemo(
    () => setupDrafts.find(setupDraft => setupDraft.id === selectedDraftId) ?? null,
    [selectedDraftId, setupDrafts]
  )

  const listItems = useMemo<AgentListItem[]>(() => {
    const agentItems: AgentListItem[] = agents.map(agent => ({
      agent,
      id: agent.id,
      timestamp: agent.updated_at,
      type: 'agent'
    }))

    const draftItems: AgentListItem[] = setupDrafts.map(setupDraft => ({
      draft: setupDraft,
      id: setupDraft.id,
      timestamp: setupDraft.updated_at,
      type: 'draft'
    }))

    return [...agentItems, ...draftItems].sort((first, second) => second.timestamp.localeCompare(first.timestamp))
  }, [agents, setupDrafts])

  const refreshAgents = useCallback(async () => {
    setError(null)
    setLoading(true)

    try {
      const [result, skillsResult, toolsResult, knowledgeResult, integrationsResult, modelsResult] =
        await Promise.allSettled([
          listWorkflowAgents(),
          listWorkflowSkillCapabilities(),
          listWorkflowToolCapabilities(),
          listKnowledgeBases(),
          listWorkflowIntegrationCapabilities(),
          getScopedModelOptions()
        ])

      if (skillsResult.status === 'fulfilled') {
        setSkillCapabilities(skillsResult.value.skills)
        setSkillCapabilityErrors(skillsResult.value.errors)
      } else {
        setSkillCapabilities([])
        setSkillCapabilityErrors([
          skillsResult.reason instanceof Error ? skillsResult.reason.message : 'Could not load skills.'
        ])
      }

      if (result.status === 'rejected') {
        throw result.reason
      }

      if (toolsResult.status === 'fulfilled') {
        setToolCapabilities(toolsResult.value.tools)
        setToolCapabilityErrors(toolsResult.value.errors)
      } else {
        setToolCapabilities([])
        setToolCapabilityErrors([
          toolsResult.reason instanceof Error ? toolsResult.reason.message : 'Could not load tools.'
        ])
      }

      if (knowledgeResult.status === 'fulfilled') {
        setKnowledgeBases(knowledgeResult.value.knowledge_bases)
      }

      if (integrationsResult.status === 'fulfilled') {
        setIntegrationCapabilities(integrationsResult.value.integrations)
        setIntegrationCapabilityErrors(integrationsResult.value.errors)
      } else {
        setIntegrationCapabilities([])
        setIntegrationCapabilityErrors([
          integrationsResult.reason instanceof Error
            ? integrationsResult.reason.message
            : 'Could not load integrations.'
        ])
      }

      if (modelsResult.status === 'fulfilled') {
        const nextModels: AgentModelOption[] = []
        const seen = new Set<string>()

        for (const provider of modelsResult.value.providers ?? []) {
          for (const model of provider.models ?? []) {
            if (!model || seen.has(model)) {
              continue
            }

            seen.add(model)
            nextModels.push({
              id: model,
              label: model,
              provider: provider.name || provider.slug
            })
          }
        }

        setModelOptions(nextModels)
        setDefaultModelId(modelsResult.value.model || nextModels[0]?.id || '')
        setModelErrors([])
      } else {
        setModelOptions([])
        setDefaultModelId('')
        setModelErrors([modelsResult.reason instanceof Error ? modelsResult.reason.message : 'Could not load models.'])
      }

      setAgents(result.value.agents)
      setSetupDrafts(result.value.setup_drafts ?? [])
      setSelectedId(current => (current && result.value.agents.some(agent => agent.id === current) ? current : null))
      setSelectedDraftId(current =>
        current && (result.value.setup_drafts ?? []).some(setupDraft => setupDraft.id === current) ? current : null
      )
    } catch (err) {
      const message = 'Could not load agents'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshDetails = useCallback(async (agentId: string) => {
    try {
      const [deliveryResult, triggerResult, runResult, embedResult] = await Promise.all([
        listWorkflowDeliveries(agentId),
        listWorkflowTriggers(agentId),
        listWorkflowRuns(agentId),
        getWorkflowAgentEmbedConfig(agentId)
      ])

      setDeliveries(deliveryResult.deliveries)
      setTriggers(triggerResult.triggers)
      setRuns(runResult.runs)
      setEmbedConfig(embedResult)
    } catch (err) {
      const message = 'Could not load agent details.'

      setError(err instanceof Error ? err.message : message)
      notifyError(err, message)
    }
  }, [])

  const refreshSkills = useCallback(async () => {
    try {
      const result = await listWorkflowSkillCapabilities()
      setSkillCapabilities(result.skills)
      setSkillCapabilityErrors(result.errors)
    } catch (err) {
      setSkillCapabilities([])
      setSkillCapabilityErrors([err instanceof Error ? err.message : 'Could not load skills.'])
      notifyError(err, 'Could not load skills')
    }
  }, [])

  const refreshTools = useCallback(async () => {
    try {
      const result = await listWorkflowToolCapabilities()
      setToolCapabilities(result.tools)
      setToolCapabilityErrors(result.errors)
    } catch (err) {
      setToolCapabilities([])
      setToolCapabilityErrors([err instanceof Error ? err.message : 'Could not load tools.'])
      notifyError(err, 'Could not load tools')
    }
  }, [])

  useEffect(() => {
    void refreshAgents()
  }, [refreshAgents])

  useEffect(() => {
    if (loading) {
      return
    }

    if (routeSelection.kind === 'list') {
      setSelectedId(null)
      setSelectedDraftId(null)
      setCreating(false)
      setSetupDraftResponse(null)
      setSetupPrompt('')
      setTab('instructions')

      return
    }

    if (routeSelection.kind === 'new') {
      setSelectedId(null)
      setSelectedDraftId(null)
      setCreating(true)
      setSetupDraftResponse(null)
      setSetupPrompt('')
      setTab('instructions')

      return
    }

    if (routeSelection.kind === 'draft') {
      const setupDraft = setupDrafts.find(item => item.id === routeSelection.id)

      if (!setupDraft) {
        setError('Agent setup draft was not found.')
        setSelectedId(null)
        setSelectedDraftId(null)
        setCreating(false)

        return
      }

      setCreating(true)
      setSelectedId(null)
      setSelectedDraftId(setupDraft.id)
      setSetupPrompt(setupDraft.prompt)
      setSetupDraftResponse({ approvals: [], draft: setupDraft })
      setTab('instructions')

      return
    }

    const agent = agents.find(item => item.id === routeSelection.id)

    if (!agent) {
      setError('Agent was not found.')
      setSelectedId(null)
      setSelectedDraftId(null)
      setCreating(false)

      return
    }

    setCreating(false)
    setSelectedDraftId(null)
    setSelectedId(agent.id)
    setTab('instructions')
  }, [agents, loading, routeSelection, setupDrafts])

  useEffect(() => {
    setDraft(() => {
      if (selectedSetupDraft) {
        return draftFromSetupDraft(selectedSetupDraft, defaultModelId)
      }

      const next = draftFromAgent(selected)

      return selected ? next : { ...next, model_id: defaultModelId }
    })

    if (selected) {
      void refreshDetails(selected.id)
    } else {
      setDeliveries([])
      setTriggers([])
      setRuns([])
      setEmbedConfig(null)
    }
  }, [defaultModelId, refreshDetails, selected, selectedSetupDraft])

  const saveAgent = async () => {
    if (!draft.name.trim()) {
      const message = 'Agent name is required.'

      setError(message)
      notify({ kind: 'error', message })

      return
    }

    setBusy(true)
    setError(null)

    const input = {
      approval_policy: draft.approval_policy,
      description: draft.description,
      enabled: draft.enabled,
      instructions: draft.instructions,
      integrations: lines(draft.integrationsText),
      knowledge: lines(draft.knowledgeText),
      model_id: draft.model_id || defaultModelId,
      name: draft.name,
      role: draft.role,
      skills: lines(draft.skillsText),
      tools: lines(draft.toolsText)
    }

    try {
      const isUpdate = Boolean(selected)
      const draftId = selectedDraftId
      const saved = selected ? await updateWorkflowAgent(selected.id, input) : await createWorkflowAgent(input)

      setAgents(current => {
        const exists = current.some(agent => agent.id === saved.id)

        return exists ? current.map(agent => (agent.id === saved.id ? saved : agent)) : [saved, ...current]
      })
      setSelectedId(saved.id)
      setSelectedDraftId(null)
      setSetupDrafts(current => current.filter(setupDraft => setupDraft.id !== draftId))
      setCreating(false)
      navigate(agentDetailRoute(saved.id))
      notify({
        kind: 'success',
        message: saved.name,
        title: isUpdate ? 'Agent saved' : 'Agent created'
      })
    } catch (err) {
      const message = selected ? 'Could not save agent' : 'Could not create agent'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
    } finally {
      setBusy(false)
    }
  }

  const removeAgent = async () => {
    if (!selected) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const name = selected.name

      await deleteWorkflowAgent(selected.id)
      setAgents(current => current.filter(agent => agent.id !== selected.id))
      setSelectedId(null)
      setDraft(draftFromAgent())
      navigate(AGENTS_ROUTE)
      notify({ kind: 'success', message: name, title: 'Agent deleted' })
    } catch (err) {
      const message = 'Could not delete agent'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
    } finally {
      setBusy(false)
    }
  }

  const createNew = () => {
    navigate(`${AGENTS_ROUTE}/new`)
  }

  const closeEditor = () => {
    navigate(AGENTS_ROUTE)
  }

  const selectAgent = (agentId: string) => {
    navigate(agentDetailRoute(agentId))
  }

  const selectSetupDraft = (setupDraftId: string) => {
    navigate(agentDraftRoute(setupDraftId))
  }

  const editorOpen = creating || selected !== null || selectedSetupDraft !== null

  const generateSetupDraft = async () => {
    if (!setupPrompt.trim()) {
      const message = 'Describe the agent you want to create or update.'

      setError(message)
      notify({ kind: 'error', message })

      return
    }

    setSetupBusy(true)
    setError(null)

    try {
      const response = selected
        ? await draftWorkflowAgentSetupUpdate(selected.id, {
            prompt: setupPrompt,
            source: 'web',
            source_ref: 'agents'
          })
        : await draftWorkflowAgentSetup({
            prompt: setupPrompt,
            source: 'web',
            source_ref: 'agents'
          })

      const agentDraft = response.draft.draft.agent

      setSetupDraftResponse(response)
      setDraft(current => ({
        ...current,
        approval_policy: agentDraft.approval_policy ?? current.approval_policy,
        description: agentDraft.description ?? current.description,
        enabled: agentDraft.enabled ?? current.enabled,
        instructions: agentDraft.instructions ?? current.instructions,
        integrationsText: (agentDraft.integrations ?? []).join('\n'),
        knowledgeText: (agentDraft.knowledge ?? []).join('\n'),
        model_id: agentDraft.model_id || current.model_id || defaultModelId,
        name: agentDraft.name || current.name,
        role: agentDraft.role ?? current.role,
        skillsText: (agentDraft.skills ?? []).join('\n'),
        toolsText: (agentDraft.tools ?? []).join('\n')
      }))
      setTab('instructions')
      notify({
        kind: 'success',
        message: agentDraft.name || 'Review the generated setup below.',
        title: selected ? 'Agent setup draft updated' : 'Agent setup draft created'
      })
    } catch (err) {
      const message = 'Could not generate agent setup'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
    } finally {
      setSetupBusy(false)
    }
  }

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden bg-(--ui-chat-surface-background) px-5 pb-4 pt-[calc(var(--titlebar-height)+1rem)] sm:px-6">
      <header className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Agents</h2>
          <p className="text-xs text-muted-foreground/80">
            Create reusable workers with skills, knowledge, tools, integrations, triggers, and runs.
          </p>
        </div>
        {!editorOpen ? (
          <div className="flex items-center gap-2">
            <Button disabled={loading || busy} onClick={() => void refreshAgents()} size="sm" variant="ghost">
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button disabled={busy} onClick={createNew} size="sm">
              <Plus className="size-4" />
              Create agent
            </Button>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="grid min-h-80 flex-1 place-items-center">
          <Loader className="size-10 text-primary" label="Loading agents" strokeScale={0.72} type="rose-curve" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          {!editorOpen ? (
            <AgentList
              items={listItems}
              onCreate={createNew}
              onSelectAgent={selectAgent}
              onSelectDraft={selectSetupDraft}
            />
          ) : null}
          {editorOpen ? (
            <main className="h-full min-w-0 overflow-y-auto pr-1">
              <AgentEditor
                busy={busy}
                defaultModelId={defaultModelId}
                draft={draft}
                integrationCapabilities={integrationCapabilities}
                integrationCapabilityErrors={integrationCapabilityErrors}
                knowledgeBases={knowledgeBases}
                modelErrors={modelErrors}
                modelOptions={modelOptions}
                onCancel={closeEditor}
                onChange={setDraft}
                onDelete={selected ? removeAgent : undefined}
                onGenerateSetupDraft={generateSetupDraft}
                onKnowledgeBasesChange={setKnowledgeBases}
                onManageApiKeys={() => navigate(`${SETTINGS_ROUTE}?tab=keys`)}
                onSave={saveAgent}
                onSkillsRefresh={refreshSkills}
                onToolsRefresh={refreshTools}
                selected={selected}
                setSetupPrompt={setSetupPrompt}
                setTab={setTab}
                setupBusy={setupBusy}
                setupDraftResponse={setupDraftResponse}
                setupPrompt={setupPrompt}
                skillCapabilities={skillCapabilities}
                skillCapabilityErrors={skillCapabilityErrors}
                tab={tab}
                toolCapabilities={toolCapabilities}
                toolCapabilityErrors={toolCapabilityErrors}
              />
              {selected ? (
                <>
                  {tab === 'triggers' ? (
                    <TriggersPanel
                      agent={selected}
                      busy={busy}
                      onBusy={setBusy}
                      onError={setError}
                      onRefresh={() => refreshDetails(selected.id)}
                      triggers={triggers}
                    />
                  ) : null}
                  {tab === 'delivery' ? (
                    <DeliveryPanel
                      agent={selected}
                      busy={busy}
                      deliveries={deliveries}
                      onBusy={setBusy}
                      onError={setError}
                      onRefresh={() => refreshDetails(selected.id)}
                    />
                  ) : null}
                  {tab === 'runs' ? (
                    <RunsPanel
                      agent={selected}
                      busy={busy}
                      onBusy={setBusy}
                      onError={setError}
                      onRefresh={() => refreshDetails(selected.id)}
                      runs={runs}
                    />
                  ) : null}
                  {tab === 'embed' ? (
                    <EmbedPanel
                      agent={selected}
                      busy={busy}
                      config={embedConfig}
                      onBusy={setBusy}
                      onConfigChange={setEmbedConfig}
                      onError={setError}
                      onRefresh={() => refreshDetails(selected.id)}
                    />
                  ) : null}
                </>
              ) : (
                <AgentSaveRequired tab={tab} />
              )}
            </main>
          ) : null}
        </div>
      )}
    </section>
  )
}

function publicAgentToken(): string {
  return decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '')
}

const VERXIO_WEBSITE_URL = 'https://www.verxio.xyz'

function PublicAgentFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-(--ui-stroke-secondary) bg-background py-3 text-center text-xs text-muted-foreground">
      Powered by{' '}
      <a
        aria-label="Verxio"
        className="inline-flex w-16 align-middle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        href={VERXIO_WEBSITE_URL}
        rel="noopener noreferrer"
        target="_blank"
      >
        <VerxioWordmark
          className="w-full"
          style={{ '--fit-text-line-height': '0.9', '--fit-text-min': '0.78rem' } as CSSProperties}
          variant="solid"
        />
      </a>
    </footer>
  )
}

export function PublicAgentShareView() {
  const [agent, setAgent] = useState<WorkflowAgentPublicInfo | null>(null)
  const [message, setMessage] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const token = publicAgentToken()

  useEffect(() => {
    let cancelled = false

    getPublicWorkflowAgent(token)
      .then(response => {
        if (!cancelled) {
          setAgent(response)
        }
      })
      .catch(fetchError => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Agent not found')
        }
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const primaryColor = agent?.primary_color || '#0ea5e9'

  async function submit() {
    if (!message.trim()) {
      setError('Enter a message for this agent.')

      return
    }

    setError(null)
    setOutput('')
    setRunning(true)

    try {
      const result = await runPublicWorkflowAgent(token, message.trim())
      const text = result.run.output_text.trim()

      setOutput(
        text || (result.run.status === 'failed' ? result.run.error || 'Agent run failed.' : 'Agent run queued.')
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run this agent.')
    } finally {
      setRunning(false)
    }
  }

  if (error && !agent) {
    return (
      <>
        <main className="grid min-h-dvh place-items-center bg-background px-4 pb-14 text-foreground">
          <section className="w-full max-w-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-5">
            <h1 className="text-base font-semibold tracking-normal">Agent unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {error === 'Public workflow agent is not available.'
                ? 'This agent is disabled or no longer public.'
                : error}
            </p>
          </section>
        </main>
        <PublicAgentFooter />
      </>
    )
  }

  if (!agent) {
    return (
      <>
        <div className="grid min-h-dvh place-items-center bg-background pb-14 text-foreground">
          <PageLoader label="Loading agent" />
        </div>
        <PublicAgentFooter />
      </>
    )
  }

  return (
    <>
      <main className="min-h-dvh bg-background px-4 pb-20 pt-8 text-foreground">
        <section className="mx-auto grid w-full max-w-3xl gap-5">
          <header className="border-b border-(--ui-stroke-secondary) pb-5">
            <div className="flex items-start gap-3">
              {agent.logo_url ? (
                <img
                  alt=""
                  className="size-12 rounded-md border border-(--ui-stroke-secondary) object-cover"
                  src={agent.logo_url}
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="grid size-12 place-items-center rounded-md text-lg font-semibold text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  {(agent.display_name || agent.name).slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Verxio Agent</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal">{agent.display_name || agent.name}</h1>
                {agent.description ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{agent.description}</p>
                ) : null}
              </div>
            </div>
          </header>

          {agent.asset_url ? (
            <img
              alt=""
              className="max-h-72 w-full rounded-md border border-(--ui-stroke-secondary) object-cover"
              src={agent.asset_url}
            />
          ) : null}

          <section className="grid gap-3 border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {agent.welcome_message || 'How can I help?'}
            </p>
            <Textarea
              onChange={event => setMessage(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder="Ask this agent anything"
              rows={6}
              value={message}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex justify-end">
              <Button
                className="min-w-28 text-white"
                disabled={running}
                onClick={() => void submit()}
                style={{ backgroundColor: primaryColor }}
                type="button"
              >
                {running ? (
                  <Loader className="size-4 text-white" label="Running agent" strokeScale={0.7} type="rose-two" />
                ) : (
                  <Send className="size-4" />
                )}
                Send
              </Button>
            </div>
          </section>

          {output ? (
            <section className="border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-4">
              <h2 className="text-sm font-semibold tracking-normal">Response</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{output}</p>
            </section>
          ) : null}
        </section>
      </main>
      <PublicAgentFooter />
    </>
  )
}

function AgentList({
  items,
  onCreate,
  onSelectAgent,
  onSelectDraft
}: {
  items: AgentListItem[]
  onCreate: () => void
  onSelectAgent: (id: string) => void
  onSelectDraft: (id: string) => void
}) {
  const [page, setPage] = useState(1)
  const visibleItems = items.slice((page - 1) * AGENT_PAGE_SIZE, page * AGENT_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / AGENT_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [items.length, page])

  if (items.length === 0) {
    return (
      <div className="grid h-full min-h-80 place-items-center rounded-md border border-dashed border-(--stroke-nous) p-5 text-center">
        <div className="grid gap-3">
          <Sparkles className="mx-auto size-6 text-primary" />
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Create the first reusable agent for payments, lead research, customer support, or internal ops.
          </p>
          <Button onClick={onCreate} size="sm">
            <Plus className="size-4" />
            Create agent
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map(item => (
          <button
            className="grid min-h-28 content-between gap-3 rounded-md border border-(--stroke-nous) p-4 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:ring-2 focus-visible:ring-primary"
            key={`${item.type}:${item.id}`}
            onClick={() => (item.type === 'agent' ? onSelectAgent(item.id) : onSelectDraft(item.id))}
            type="button"
          >
            {item.agent ? <AgentListAgentCard agent={item.agent} /> : null}
            {item.draft ? <AgentListDraftCard setupDraft={item.draft} /> : null}
          </button>
        ))}
      </div>
      <PaginationControl
        className="mt-2 border-t border-(--stroke-nous) pt-2"
        itemLabel="agents"
        onPageChange={setPage}
        page={page}
        pageSize={AGENT_PAGE_SIZE}
        total={items.length}
      />
    </div>
  )
}

function AgentListAgentCard({ agent }: { agent: WorkflowAgent }) {
  return (
    <>
      <span className="grid gap-1">
        <span className="flex items-center gap-2 text-xs font-medium">
          <span className={cn('size-1.5 rounded-full', agent.enabled ? 'bg-primary' : 'bg-muted-foreground/50')} />
          {agent.name}
        </span>
        <span className="line-clamp-2 text-[0.7rem] leading-relaxed text-muted-foreground">
          {agent.role || agent.description || 'Reusable workflow agent'}
        </span>
      </span>
      <span className="text-[0.65rem] font-medium text-primary">Configure agent</span>
    </>
  )
}

function AgentListDraftCard({ setupDraft }: { setupDraft: WorkflowAgentSetupDraft }) {
  const agent = setupDraft.draft.agent
  const missing = setupDraft.draft.missing ?? []

  return (
    <>
      <span className="grid gap-1">
        <span className="flex items-center gap-2 text-xs font-medium">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {agent.name || 'Untitled setup draft'}
        </span>
        <span className="line-clamp-2 text-[0.7rem] leading-relaxed text-muted-foreground">
          {agent.role || agent.description || setupDraft.prompt}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-[0.65rem] font-medium">
        <span className="rounded-full border border-amber-500/25 bg-amber-500/8 px-2 py-0.5 text-amber-600">Draft</span>
        {missing.length > 0 ? <span className="text-muted-foreground">{missing.length} setup item(s)</span> : null}
        <span className="text-primary">Review setup</span>
      </span>
    </>
  )
}

function AgentEditor({
  busy,
  defaultModelId,
  draft,
  integrationCapabilities,
  integrationCapabilityErrors,
  knowledgeBases,
  modelErrors,
  modelOptions,
  onCancel,
  onChange,
  onDelete,
  onGenerateSetupDraft,
  onKnowledgeBasesChange,
  onManageApiKeys,
  onSave,
  onSkillsRefresh,
  onToolsRefresh,
  selected,
  setTab,
  setupBusy,
  setupDraftResponse,
  setupPrompt,
  setSetupPrompt,
  skillCapabilities,
  skillCapabilityErrors,
  tab,
  toolCapabilities,
  toolCapabilityErrors
}: {
  busy: boolean
  defaultModelId: string
  draft: DraftState
  integrationCapabilities: WorkflowIntegrationCapability[]
  integrationCapabilityErrors: string[]
  knowledgeBases: KnowledgeBase[]
  modelErrors: string[]
  modelOptions: AgentModelOption[]
  onCancel: () => void
  onChange: (draft: DraftState) => void
  onDelete?: () => void
  onGenerateSetupDraft: () => Promise<void>
  onKnowledgeBasesChange: (knowledgeBases: KnowledgeBase[]) => void
  onManageApiKeys: () => void
  onSave: () => void
  onSkillsRefresh: () => Promise<void>
  onToolsRefresh: () => Promise<void>
  selected: WorkflowAgent | null
  setTab: (tab: AgentTab) => void
  setupBusy: boolean
  setupDraftResponse: WorkflowAgentSetupDraftResponse | null
  setupPrompt: string
  setSetupPrompt: (value: string) => void
  skillCapabilities: WorkflowSkillCapability[]
  skillCapabilityErrors: string[]
  tab: AgentTab
  toolCapabilities: WorkflowToolCapability[]
  toolCapabilityErrors: string[]
}) {
  const patch = (updates: Partial<DraftState>) => onChange({ ...draft, ...updates })
  const savedModelMissing = draft.model_id && !modelOptions.some(model => model.id === draft.model_id)

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <Button disabled={busy || setupBusy} onClick={onCancel} size="sm" variant="ghost">
          <ChevronLeft className="size-4" />
          Back to agents
        </Button>
        <span className="text-xs text-muted-foreground">{selected ? `Editing ${selected.name}` : 'New agent'}</span>
      </div>
      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-foreground">Setup assistant</h3>
            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
              Describe the workflow, then review and edit the generated setup below.
            </p>
          </div>
          {setupDraftResponse ? (
            <span className="rounded-full border border-primary/25 bg-primary/8 px-2 py-1 text-[0.65rem] font-medium text-primary">
              Draft applied
            </span>
          ) : null}
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <Textarea
            className="min-h-24"
            disabled={busy || setupBusy}
            onChange={event => setSetupPrompt(event.target.value)}
            placeholder="Create a payment delivery agent. Trigger it when Paystack payment succeeds. Send WhatsApp to the customer, notify Slack ops, use our delivery policy KB, and ask for approval if confidence is low."
            value={setupPrompt}
          />
          <Button
            className="md:self-start"
            disabled={busy || setupBusy || !setupPrompt.trim()}
            onClick={() => void onGenerateSetupDraft()}
            size="sm"
          >
            {setupBusy ? (
              <Loader className="size-4 text-primary" label="Generating setup" strokeScale={0.7} type="rose-two" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Generate setup
          </Button>
        </div>
        {setupBusy ? (
          <div className="grid min-h-24 place-items-center rounded-md border border-dashed border-(--stroke-nous)">
            <Loader
              className="size-8 text-primary"
              label="Generating agent setup"
              strokeScale={0.72}
              type="rose-curve"
            />
          </div>
        ) : null}
        {setupDraftResponse ? <SetupDraftReview response={setupDraftResponse} /> : null}
      </div>

      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-medium">
            Name
            <Input
              disabled={busy}
              onChange={event => patch({ name: event.target.value })}
              placeholder="Payment Delivery Agent"
              value={draft.name}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Role
            <Input
              disabled={busy}
              onChange={event => patch({ role: event.target.value })}
              placeholder="Notify customers after successful payment"
              value={draft.role}
            />
          </label>
        </div>
        <label className="grid gap-1.5 text-xs font-medium">
          Description
          <Input
            disabled={busy}
            onChange={event => patch({ description: event.target.value })}
            placeholder="What this agent owns"
            value={draft.description}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Brain model
          <Select
            disabled={busy || modelOptions.length === 0}
            onValueChange={value => patch({ model_id: value })}
            value={draft.model_id || defaultModelId}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {savedModelMissing ? <SelectItem value={draft.model_id}>{draft.model_id} (saved)</SelectItem> : null}
              {modelOptions.map(model => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label} · {model.provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {modelErrors.length > 0 ? (
            <span className="text-[0.7rem] leading-relaxed text-muted-foreground">{modelErrors.join(' ')}</span>
          ) : null}
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs transition-colors',
              draft.enabled
                ? 'border-primary/45 bg-primary/5 text-foreground'
                : 'border-(--stroke-nous) bg-(--ui-bg-elevated) text-muted-foreground'
            )}
            onClick={() => patch({ enabled: !draft.enabled })}
            type="button"
          >
            <Switch checked={draft.enabled} size="xs" tabIndex={-1} />
            {draft.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <div className="flex items-center gap-2">
            {onDelete ? (
              <Button disabled={busy} onClick={onDelete} size="sm" variant="ghost">
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null}
            <Button disabled={busy} onClick={onSave} size="sm">
              {busy ? (
                <Loader className="size-4 text-primary" label="Saving agent" strokeScale={0.7} type="rose-two" />
              ) : (
                <Save className="size-4" />
              )}
              {selected ? 'Save agent' : 'Create agent'}
            </Button>
          </div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-(--stroke-nous)">
        {AGENT_TABS.map(item => (
          <button
            className={cn(
              'shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
              tab === item.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            key={item.id}
            onClick={() => setTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'instructions' ? (
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            Instructions
            <Textarea
              className="min-h-44"
              disabled={busy}
              onChange={event => patch({ instructions: event.target.value })}
              placeholder="Tell the agent how to behave, what outcomes it owns, when to ask for approval, and what result to return."
              value={draft.instructions}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Approval policy
            <Input
              disabled={busy}
              onChange={event => patch({ approval_policy: event.target.value })}
              placeholder="default / ask_before_external_actions"
              value={draft.approval_policy}
            />
          </label>
        </div>
      ) : null}
      {tab === 'skills' ? (
        <SkillSelector
          disabled={busy}
          errors={skillCapabilityErrors}
          onChange={items => patch({ skillsText: items.join('\n') })}
          onRefresh={onSkillsRefresh}
          selected={lines(draft.skillsText)}
          skills={skillCapabilities}
        />
      ) : null}
      {tab === 'knowledge' ? (
        <KnowledgeSelector
          disabled={busy}
          knowledgeBases={knowledgeBases}
          onChange={items => patch({ knowledgeText: items.join('\n') })}
          onKnowledgeBasesChange={onKnowledgeBasesChange}
          selected={lines(draft.knowledgeText)}
        />
      ) : null}
      {tab === 'integrations' ? (
        <IntegrationSelector
          disabled={busy}
          errors={integrationCapabilityErrors}
          integrations={integrationCapabilities}
          onChange={items => patch({ integrationsText: items.join('\n') })}
          selected={lines(draft.integrationsText)}
        />
      ) : null}
      {tab === 'tools' ? (
        <ToolSelector
          disabled={busy}
          errors={toolCapabilityErrors}
          onChange={items => patch({ toolsText: items.join('\n') })}
          onManageApiKeys={onManageApiKeys}
          onRefresh={onToolsRefresh}
          selected={lines(draft.toolsText)}
          tools={toolCapabilities}
        />
      ) : null}
    </section>
  )
}

function SetupDraftReview({ response }: { response: WorkflowAgentSetupDraftResponse }) {
  const { draft } = response.draft
  const triggers = Array.isArray(draft.triggers) ? draft.triggers : []
  const deliveries = Array.isArray(draft.deliveries) ? draft.deliveries : []
  const notes = Array.isArray(draft.notes) ? draft.notes : []

  const missingSetup = Array.isArray(draft.missing_setup)
    ? draft.missing_setup
    : Array.isArray(draft.missing)
      ? draft.missing
      : []

  const approvals = Array.isArray(response.approvals) ? response.approvals : []
  const pendingApprovals = approvals.filter(approval => approval.status === 'pending')

  return (
    <div className="grid gap-3 rounded-md border border-(--stroke-nous) bg-muted/20 p-3">
      <div className="grid gap-2 md:grid-cols-3">
        <SetupDraftMetric label="Triggers" value={triggers.length} />
        <SetupDraftMetric label="Delivery" value={deliveries.length} />
        <SetupDraftMetric label="Approvals" value={pendingApprovals.length} />
      </div>

      {notes.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-[0.7rem] font-medium text-foreground">Setup notes</p>
          <div className="grid gap-1">
            {notes.map(note => (
              <p className="text-[0.7rem] leading-relaxed text-muted-foreground" key={note}>
                {note}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {missingSetup.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-amber-500/25 bg-amber-500/8 p-2">
          <p className="text-[0.7rem] font-medium text-foreground">Needs setup before activation</p>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{missingSetup.join(', ')}</p>
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        <SetupDraftList
          empty="No trigger draft generated."
          items={triggers.map(
            trigger => `${trigger.name} · ${trigger.trigger_type} · ${trigger.enabled ? 'enabled' : 'disabled'}`
          )}
          title="Generated triggers"
        />
        <SetupDraftList
          empty="No delivery draft generated."
          items={deliveries.map(delivery => {
            const name =
              delivery.name || delivery.delivery_type || delivery.channel || delivery.destination || 'Delivery'

            return `${name} · ${delivery.delivery_type}${delivery.channel ? ` · ${delivery.channel}` : ''} · ${
              delivery.enabled ? 'enabled' : 'disabled'
            }`
          })}
          title="Generated delivery"
        />
      </div>

      {pendingApprovals.length > 0 ? (
        <SetupDraftList
          empty="No approvals needed."
          items={pendingApprovals.map(approval => {
            const action = approval.action_label || approval.action || 'Approval required'
            const risk = approval.risk || approval.risk_type || 'external_delivery'

            return `${action} · ${risk.replace(/_/g, ' ')}`
          })}
          title="Approval required"
        />
      ) : null}
    </div>
  )
}

function AgentSaveRequired({ tab }: { tab: AgentTab }) {
  const messages: Partial<Record<AgentTab, { description: string; title: string }>> = {
    delivery: {
      description:
        'Create the agent first, then add output destinations such as the source conversation, WhatsApp, Slack, email, a Composio action, or a callback webhook.',
      title: 'Save before adding delivery'
    },
    embed: {
      description:
        'Create the agent first so Verxio can issue its public share URL and embed token, then configure branding, allowed websites, and uploaded assets.',
      title: 'Save before publishing'
    },
    runs: {
      description: 'Create the agent first, then test it manually and review its execution history and events here.',
      title: 'Save before running'
    },
    triggers: {
      description:
        'Create the agent first, then choose what starts it: manual input, webhook/API, schedule, connected app, messaging gateway, or embed/share input.',
      title: 'Save before adding triggers'
    }
  }

  const message = messages[tab]

  if (!message) {
    return null
  }

  return (
    <section className="mt-4 grid min-h-40 place-items-center rounded-md border border-dashed border-(--stroke-nous) p-5 text-center">
      <div className="grid max-w-lg gap-2">
        <Sparkles aria-hidden="true" className="mx-auto size-5 text-primary" />
        <p className="text-xs font-medium">{message.title}</p>
        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{message.description}</p>
      </div>
    </section>
  )
}

function SetupDraftMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-(--stroke-nous) bg-background/60 px-3 py-2">
      <p className="text-[0.65rem] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function SetupDraftList({ empty, items, title }: { empty: string; items: string[]; title: string }) {
  return (
    <div className="grid content-start gap-1 rounded-md border border-(--stroke-nous) bg-background/60 p-2">
      <p className="text-[0.7rem] font-medium text-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{empty}</p>
      ) : (
        items.map(item => (
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground" key={item}>
            {item}
          </p>
        ))
      )}
    </div>
  )
}

function ToolSelector({
  disabled,
  errors,
  onChange,
  onManageApiKeys,
  onRefresh,
  selected,
  tools
}: {
  disabled: boolean
  errors: string[]
  onChange: (items: string[]) => void
  onManageApiKeys: () => void
  onRefresh: () => Promise<void>
  selected: string[]
  tools: WorkflowToolCapability[]
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const missingSelected = selected.filter(name => !tools.some(tool => tool.name === name))
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<ToolCatalogMode>('default')
  const [draft, setDraft] = useState<CustomToolDraft>(() => emptyCustomToolDraft())
  const [saving, setSaving] = useState(false)
  const defaultTools = useMemo(() => tools.filter(tool => tool.source !== 'custom' && tool.enabled), [tools])
  const customTools = useMemo(() => tools.filter(tool => tool.source === 'custom'), [tools])
  const activeTools = mode === 'custom' ? customTools : defaultTools
  const visibleTools = activeTools.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(activeTools.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [activeTools.length, page])

  useEffect(() => {
    setPage(1)
  }, [mode])

  const toggle = (name: string) => {
    if (disabled || mode === 'add') {
      return
    }

    const next = new Set(selectedSet)

    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }

    onChange(Array.from(next).sort((a, b) => a.localeCompare(b)))
  }

  const saveCustomTool = async () => {
    if (disabled || saving) {
      return
    }

    setSaving(true)

    try {
      const schema = draft.request_schema.trim() ? JSON.parse(draft.request_schema) : {}

      const created = await createWorkflowCustomTool({
        api_key_env: draft.api_key_env,
        auth_type: draft.auth_type,
        description: draft.description,
        method: draft.method,
        name: draft.name,
        request_schema: schema,
        response_hint: draft.response_hint,
        url: draft.url
      })

      notify({ kind: 'success', title: 'Custom tool added', message: `${created.name} is ready to select.` })
      setDraft(emptyCustomToolDraft())
      setMode('custom')
      await onRefresh()
    } catch (err) {
      notifyError(err, 'Could not add custom tool')
    } finally {
      setSaving(false)
    }
  }

  const selectedModeCount = mode === 'custom' ? customTools.length : defaultTools.length

  return (
    <div className="grid gap-3">
      {errors.length > 0 ? (
        <div className="rounded-md border border-(--stroke-nous) bg-muted/25 px-3 py-2 text-[0.7rem] leading-relaxed text-muted-foreground">
          {errors.join(' ')}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-md bg-muted/30 p-1">
          {[
            { id: 'default', label: `Default (${defaultTools.length})` },
            { id: 'custom', label: `Custom (${customTools.length})` },
            { id: 'add', label: 'Add tool' }
          ].map(item => (
            <button
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                mode === item.id && 'bg-background text-primary shadow-sm'
              )}
              key={item.id}
              onClick={() => setMode(item.id as ToolCatalogMode)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <Button disabled={disabled} onClick={onManageApiKeys} size="sm" type="button" variant="outline">
          Manage API keys
        </Button>
      </div>

      {mode === 'add' ? (
        <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
          <div className="grid gap-1">
            <p className="text-xs font-semibold text-foreground">Add custom API tool</p>
            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
              Define the endpoint and env var name. Store the actual API key in Settings / Keys.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium">
              Name
              <Input
                disabled={disabled || saving}
                onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                placeholder="YouCam Skin Analysis"
                value={draft.name}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              Method
              <Select
                disabled={disabled || saving}
                onValueChange={value => setDraft(current => ({ ...current, method: value }))}
                value={draft.method}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">
            Endpoint URL
            <Input
              disabled={disabled || saving}
              onChange={event => setDraft(current => ({ ...current, url: event.target.value }))}
              placeholder="https://api.example.com/v1/analyze"
              value={draft.url}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium">
              Auth
              <Select
                disabled={disabled || saving}
                onValueChange={value =>
                  setDraft(current => ({ ...current, auth_type: value as CustomToolDraft['auth_type'] }))
                }
                value={draft.auth_type}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api_key">API key</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="none">No auth</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              API key env var
              <Input
                disabled={disabled || saving || draft.auth_type === 'none'}
                onChange={event => setDraft(current => ({ ...current, api_key_env: event.target.value.toUpperCase() }))}
                placeholder="YOUCAM_API_KEY"
                value={draft.api_key_env}
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-(--stroke-nous) bg-muted/20 px-3 py-2">
            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
              Add or update the secret value in Settings / Keys using the same env var name.
            </p>
            <Button disabled={disabled || saving} onClick={onManageApiKeys} size="sm" type="button" variant="outline">
              Open keys
            </Button>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">
            Description
            <Textarea
              className="min-h-20"
              disabled={disabled || saving}
              onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
              placeholder="What the agent should use this API for."
              value={draft.description}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Request schema
            <Textarea
              className="min-h-28 font-mono text-[0.72rem]"
              disabled={disabled || saving}
              onChange={event => setDraft(current => ({ ...current, request_schema: event.target.value }))}
              value={draft.request_schema}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Response hint
            <Textarea
              className="min-h-20"
              disabled={disabled || saving}
              onChange={event => setDraft(current => ({ ...current, response_hint: event.target.value }))}
              placeholder="Tell the agent which fields matter in the response."
              value={draft.response_hint}
            />
          </label>
          <div className="flex justify-end">
            <Button
              disabled={disabled || saving || !draft.name.trim() || !draft.url.trim()}
              onClick={() => void saveCustomTool()}
              size="sm"
              type="button"
            >
              {saving ? (
                <Loader className="size-4 text-primary" label="Adding custom tool" strokeScale={0.7} type="rose-two" />
              ) : (
                <Plus className="size-4" />
              )}
              Add tool
            </Button>
          </div>
        </div>
      ) : activeTools.length === 0 ? (
        <div className="grid gap-3 rounded-md border border-dashed border-(--stroke-nous) p-4 text-xs text-muted-foreground">
          <div className="grid gap-1">
            <p className="font-medium text-foreground">
              {mode === 'custom' ? 'No custom tools yet' : 'No active tools are available for this agent yet'}
            </p>
            <p className="leading-relaxed">
              {mode === 'custom'
                ? 'Add a custom API tool for APIs like YouCam, courier services, internal systems, or pricing engines.'
                : 'Active runtime tools appear here when they are available in the user workspace.'}
            </p>
          </div>
          {mode === 'custom' ? (
            <div>
              <Button disabled={disabled} onClick={() => setMode('add')} size="sm" type="button" variant="outline">
                Add custom tool
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            {mode === 'custom'
              ? 'Pick custom API tools this agent can use. The API key value stays in shared credentials.'
              : 'Pick active runtime tools this agent can use.'}
          </p>
          {visibleTools.map(tool => {
            const checked = selectedSet.has(tool.name)
            const label = tool.display_name || tool.name

            const toolDetail =
              tool.tools.length > 0
                ? tool.tools.slice(0, 8).join(' · ') +
                  (tool.tools.length > 8 ? ` · +${tool.tools.length - 8} more` : '')
                : [tool.method, tool.url, tool.api_key_env || tool.category].filter(Boolean).join(' · ')

            return (
              <button
                className={cn(
                  'grid gap-1 rounded-md border border-(--stroke-nous) p-3 text-left transition-colors hover:bg-(--chrome-action-hover)',
                  checked && 'border-primary/45 bg-primary/8'
                )}
                disabled={disabled || !tool.enabled}
                key={`${tool.source}:${tool.name}`}
                onClick={() => toggle(tool.name)}
                type="button"
              >
                <span className="flex flex-wrap items-center gap-2 text-xs font-medium">
                  <span
                    className={cn(
                      'grid size-3 place-items-center rounded-sm border',
                      checked && 'border-primary bg-primary'
                    )}
                  >
                    {checked ? <CheckCircle2 className="size-2.5 text-primary-foreground" /> : null}
                  </span>
                  {label}
                  <span className="text-[0.65rem] font-normal text-muted-foreground">
                    {tool.source === 'hermes_toolset' ? 'default' : tool.source}
                  </span>
                  {!tool.enabled ? (
                    <span className="text-[0.65rem] font-normal text-muted-foreground">setup required</span>
                  ) : null}
                </span>
                {tool.description ? (
                  <span className="text-[0.7rem] leading-relaxed text-muted-foreground">{tool.description}</span>
                ) : null}
                {toolDetail ? (
                  <span className="text-[0.65rem] leading-relaxed text-muted-foreground">{toolDetail}</span>
                ) : null}
              </button>
            )
          })}
          <PaginationControl
            itemLabel="tools"
            onPageChange={setPage}
            page={page}
            pageSize={PANEL_PAGE_SIZE}
            total={selectedModeCount}
          />
        </div>
      )}
      {missingSelected.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-(--stroke-nous) p-3">
          <p className="text-xs font-medium">Saved tools not in live catalog</p>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{missingSelected.join(', ')}</p>
        </div>
      ) : null}
    </div>
  )
}

function IntegrationSelector({
  disabled,
  errors,
  integrations,
  onChange,
  selected
}: {
  disabled: boolean
  errors: string[]
  integrations: WorkflowIntegrationCapability[]
  onChange: (items: string[]) => void
  selected: string[]
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const missingSelected = selected.filter(slug => !integrations.some(integration => integration.slug === slug))
  const [page, setPage] = useState(1)
  const visibleIntegrations = integrations.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(integrations.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [integrations.length, page])

  const toggle = (slug: string) => {
    if (disabled) {
      return
    }

    const next = new Set(selectedSet)

    if (next.has(slug)) {
      next.delete(slug)
    } else {
      next.add(slug)
    }

    onChange(Array.from(next).sort((a, b) => a.localeCompare(b)))
  }

  return (
    <div className="grid gap-3">
      {errors.length > 0 ? (
        <div className="rounded-md border border-(--stroke-nous) bg-muted/25 px-3 py-2 text-[0.7rem] leading-relaxed text-muted-foreground">
          {errors.join(' ')}
        </div>
      ) : null}
      {integrations.length === 0 ? (
        <div className="rounded-md border border-dashed border-(--stroke-nous) p-4 text-xs text-muted-foreground">
          No Composio integrations are available yet. Connect apps in Settings, then attach them here.
        </div>
      ) : (
        <div className="grid gap-2">
          {visibleIntegrations.map(integration => {
            const checked = selectedSet.has(integration.slug)

            return (
              <button
                className={cn(
                  'grid gap-1 rounded-md border border-(--stroke-nous) p-3 text-left transition-colors hover:bg-(--chrome-action-hover)',
                  checked && 'border-primary/45 bg-primary/8'
                )}
                disabled={disabled}
                key={integration.slug}
                onClick={() => toggle(integration.slug)}
                type="button"
              >
                <span className="flex items-center gap-2 text-xs font-medium">
                  <span
                    className={cn(
                      'grid size-3 place-items-center rounded-sm border',
                      checked && 'border-primary bg-primary'
                    )}
                  >
                    {checked ? <CheckCircle2 className="size-2.5 text-primary-foreground" /> : null}
                  </span>
                  {integration.name}
                  <span
                    className={cn(
                      'text-[0.65rem] font-normal',
                      integration.connected ? 'text-primary' : 'text-muted-foreground'
                    )}
                  >
                    {integration.connected ? 'connected' : 'not connected'}
                  </span>
                </span>
                {integration.description ? (
                  <span className="text-[0.7rem] leading-relaxed text-muted-foreground">{integration.description}</span>
                ) : null}
              </button>
            )
          })}
          <PaginationControl
            itemLabel="integrations"
            onPageChange={setPage}
            page={page}
            pageSize={PANEL_PAGE_SIZE}
            total={integrations.length}
          />
        </div>
      )}
      {missingSelected.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-(--stroke-nous) p-3">
          <p className="text-xs font-medium">Saved integrations not in live catalog</p>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{missingSelected.join(', ')}</p>
        </div>
      ) : null}
    </div>
  )
}

function KnowledgeSelector({
  disabled,
  knowledgeBases,
  onChange,
  onKnowledgeBasesChange,
  selected
}: {
  disabled: boolean
  knowledgeBases: KnowledgeBase[]
  onChange: (items: string[]) => void
  onKnowledgeBasesChange: (knowledgeBases: KnowledgeBase[]) => void
  selected: string[]
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [documentBaseId, setDocumentBaseId] = useState('')
  const [documentTitle, setDocumentTitle] = useState('')
  const [documentContent, setDocumentContent] = useState('')
  const [localBusy, setLocalBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const missingSelected = selected.filter(item => !knowledgeBases.some(base => base.id === item || base.name === item))
  const visibleKnowledgeBases = knowledgeBases.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(knowledgeBases.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [knowledgeBases.length, page])

  const refreshKnowledgeBases = async () => {
    const result = await listKnowledgeBases()
    onKnowledgeBasesChange(result.knowledge_bases)
  }

  const toggle = (id: string) => {
    if (disabled || localBusy) {
      return
    }

    const next = new Set(selectedSet)

    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }

    onChange(Array.from(next).sort((a, b) => a.localeCompare(b)))
  }

  const addKnowledgeBase = async () => {
    if (!name.trim()) {
      const message = 'Knowledge base name is required.'

      setError(message)
      notify({ kind: 'error', message })

      return
    }

    setLocalBusy(true)
    setError(null)

    try {
      const created = await createKnowledgeBase({ description, name })
      setName('')
      setDescription('')
      await refreshKnowledgeBases()
      onChange(Array.from(new Set([...selected, created.id])).sort((a, b) => a.localeCompare(b)))
      notify({ kind: 'success', title: 'Knowledge base created', message: created.name })
    } catch (err) {
      const message = 'Could not create knowledge base'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
    } finally {
      setLocalBusy(false)
    }
  }

  const addDocument = async () => {
    if (!documentBaseId || !documentTitle.trim() || !documentContent.trim()) {
      const message = 'Select a knowledge base and add a document title and content.'

      setError(message)
      notify({ kind: 'error', message })

      return
    }

    setLocalBusy(true)
    setError(null)

    try {
      await createKnowledgeDocument(documentBaseId, {
        content: documentContent,
        source: 'manual',
        title: documentTitle
      })
      setDocumentTitle('')
      setDocumentContent('')
      await refreshKnowledgeBases()
      notify({ kind: 'success', title: 'Knowledge document added', message: documentTitle.trim() })
    } catch (err) {
      const message = 'Could not add knowledge document'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
    } finally {
      setLocalBusy(false)
    }
  }

  const removeBase = async (id: string) => {
    setLocalBusy(true)
    setError(null)

    try {
      await deleteKnowledgeBase(id)
      await refreshKnowledgeBases()
      onChange(selected.filter(item => item !== id))
      notify({ kind: 'success', message: 'Knowledge base removed' })
    } catch (err) {
      const message = 'Could not delete knowledge base'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
    } finally {
      setLocalBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <h3 className="text-xs font-semibold">Create knowledge base</h3>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            disabled={disabled || localBusy}
            onChange={event => setName(event.target.value)}
            placeholder="Retail Returns"
            value={name}
          />
          <Input
            disabled={disabled || localBusy}
            onChange={event => setDescription(event.target.value)}
            placeholder="Industry policies, delivery rules, qualification criteria"
            value={description}
          />
          <Button disabled={disabled || localBusy} onClick={addKnowledgeBase} size="sm">
            {localBusy ? (
              <Loader
                className="size-4 text-primary"
                label="Creating knowledge base"
                strokeScale={0.7}
                type="rose-two"
              />
            ) : (
              <Plus className="size-4" />
            )}
            Create
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <h3 className="text-xs font-semibold">Add document</h3>
        <div className="grid gap-2 md:grid-cols-[14rem_minmax(0,1fr)_auto]">
          <Select
            disabled={disabled || localBusy || knowledgeBases.length === 0}
            onValueChange={setDocumentBaseId}
            value={documentBaseId}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Knowledge base" />
            </SelectTrigger>
            <SelectContent>
              {knowledgeBases.map(base => (
                <SelectItem key={base.id} value={base.id}>
                  {base.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            disabled={disabled || localBusy}
            onChange={event => setDocumentTitle(event.target.value)}
            placeholder="Return policy"
            value={documentTitle}
          />
          <Button disabled={disabled || localBusy} onClick={addDocument} size="sm">
            {localBusy ? (
              <Loader className="size-4 text-primary" label="Adding document" strokeScale={0.7} type="rose-two" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </div>
        <Textarea
          className="min-h-28"
          disabled={disabled || localBusy}
          onChange={event => setDocumentContent(event.target.value)}
          placeholder="Paste product, policy, ICP, support, industry, or domain knowledge for this agent to retrieve during runs."
          value={documentContent}
        />
      </div>

      <div className="grid gap-2">
        {knowledgeBases.length === 0 ? (
          <div className="rounded-md border border-dashed border-(--stroke-nous) p-4 text-xs text-muted-foreground">
            No knowledge bases yet. Create one, add documents, then attach it to the agent.
          </div>
        ) : (
          visibleKnowledgeBases.map(base => {
            const checked = selectedSet.has(base.id) || selectedSet.has(base.name)

            return (
              <div
                className={cn(
                  'grid gap-2 rounded-md border border-(--stroke-nous) p-3',
                  checked && 'border-primary/45 bg-primary/8'
                )}
                key={base.id}
              >
                <button
                  className="grid gap-1 text-left"
                  disabled={disabled || localBusy}
                  onClick={() => toggle(base.id)}
                  type="button"
                >
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <span
                      className={cn(
                        'grid size-3 place-items-center rounded-sm border',
                        checked && 'border-primary bg-primary'
                      )}
                    >
                      {checked ? <CheckCircle2 className="size-2.5 text-primary-foreground" /> : null}
                    </span>
                    {base.name}
                    <span className="text-[0.65rem] font-normal text-muted-foreground">
                      {base.document_count} {base.document_count === 1 ? 'document' : 'documents'}
                    </span>
                  </span>
                  {base.description ? (
                    <span className="text-[0.7rem] leading-relaxed text-muted-foreground">{base.description}</span>
                  ) : null}
                </button>
                <div className="flex justify-end">
                  <Button
                    disabled={disabled || localBusy}
                    onClick={() => void removeBase(base.id)}
                    size="sm"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              </div>
            )
          })
        )}
        {knowledgeBases.length > 0 ? (
          <PaginationControl
            itemLabel="knowledge bases"
            onPageChange={setPage}
            page={page}
            pageSize={PANEL_PAGE_SIZE}
            total={knowledgeBases.length}
          />
        ) : null}
      </div>

      {missingSelected.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-(--stroke-nous) p-3">
          <p className="text-xs font-medium">Saved knowledge selections not found</p>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{missingSelected.join(', ')}</p>
        </div>
      ) : null}
    </div>
  )
}

function SkillSelector({
  disabled,
  errors,
  onChange,
  onRefresh,
  selected,
  skills
}: {
  disabled: boolean
  errors: string[]
  onChange: (items: string[]) => void
  onRefresh: () => Promise<void>
  selected: string[]
  skills: WorkflowSkillCapability[]
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const missingSelected = selected.filter(name => !skills.some(skill => skill.name === name))
  const [page, setPage] = useState(1)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSkill, setEditorSkill] = useState<string | null>(null)
  const visibleSkills = skills.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(skills.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, skills.length])

  const toggle = (name: string) => {
    if (disabled) {
      return
    }

    const next = new Set(selectedSet)

    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }

    onChange(Array.from(next).sort((a, b) => a.localeCompare(b)))
  }

  const openCreateEditor = () => {
    setEditorSkill(null)
    setEditorOpen(true)
  }

  const openEditEditor = (name: string) => {
    setEditorSkill(name)
    setEditorOpen(true)
  }

  const handleSaved = (name: string) => {
    void onRefresh()
    onChange(Array.from(new Set([...selected, name])).sort((a, b) => a.localeCompare(b)))
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Attach existing skills or create a custom skill for this agent.</p>
        <Button disabled={disabled} onClick={openCreateEditor} size="sm" type="button" variant="ghost">
          <Plus className="size-4" />
          New skill
        </Button>
      </div>
      {errors.length > 0 ? (
        <div className="rounded-md border border-(--stroke-nous) bg-muted/25 px-3 py-2 text-[0.7rem] leading-relaxed text-muted-foreground">
          {errors.join(' ')}
        </div>
      ) : null}
      {skills.length === 0 ? (
        <div className="rounded-md border border-dashed border-(--stroke-nous) p-4 text-xs text-muted-foreground">
          No live skills were reported by the runtime. Saved selections remain attached, and this list will populate
          when the runtime exposes skills metadata.
        </div>
      ) : (
        <div className="grid gap-2">
          {visibleSkills.map(skill => {
            const checked = selectedSet.has(skill.name)

            return (
              <div
                className={cn(
                  'grid gap-2 rounded-md border border-(--stroke-nous) p-3 text-left transition-colors hover:bg-(--chrome-action-hover)',
                  checked && 'border-primary/45 bg-primary/8'
                )}
                key={skill.name}
              >
                <button
                  className="grid gap-1 text-left"
                  disabled={disabled}
                  onClick={() => toggle(skill.name)}
                  type="button"
                >
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <span
                      className={cn(
                        'grid size-3 place-items-center rounded-sm border',
                        checked && 'border-primary bg-primary'
                      )}
                    >
                      {checked ? <CheckCircle2 className="size-2.5 text-primary-foreground" /> : null}
                    </span>
                    {skill.name}
                    {skill.category ? (
                      <span className="text-[0.65rem] font-normal text-muted-foreground">{skill.category}</span>
                    ) : null}
                  </span>
                  {skill.description ? (
                    <span className="text-[0.7rem] leading-relaxed text-muted-foreground">{skill.description}</span>
                  ) : null}
                </button>
                <div className="flex justify-end">
                  <Button disabled={disabled} onClick={() => openEditEditor(skill.name)} size="sm" variant="ghost">
                    Edit
                  </Button>
                </div>
              </div>
            )
          })}
          <PaginationControl
            itemLabel="skills"
            onPageChange={setPage}
            page={page}
            pageSize={PANEL_PAGE_SIZE}
            total={skills.length}
          />
        </div>
      )}
      {missingSelected.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-(--stroke-nous) p-3">
          <p className="text-xs font-medium">Saved selections not in live catalog</p>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{missingSelected.join(', ')}</p>
        </div>
      ) : null}
      <SkillEditorDialog
        editName={editorSkill}
        onClose={() => setEditorOpen(false)}
        onSaved={handleSaved}
        open={editorOpen}
      />
    </div>
  )
}

interface DeliveryFormState {
  channel: string
  configText: string
  delivery_type: WorkflowDeliveryType
  destination: string
  enabled: boolean
  name: string
  require_approval: boolean
  template: string
}

function deliveryFormFromRecord(delivery?: WorkflowDelivery | null): DeliveryFormState {
  return {
    channel: delivery?.channel ?? '',
    configText: JSON.stringify(delivery?.config ?? {}, null, 2),
    delivery_type: delivery?.delivery_type ?? 'save_only',
    destination: delivery?.destination ?? '',
    enabled: delivery?.enabled ?? true,
    name: delivery?.name ?? '',
    require_approval: delivery?.require_approval ?? false,
    template: delivery?.template ?? ''
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read asset.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

function EmbedPanel({
  agent,
  busy,
  config,
  onBusy,
  onConfigChange,
  onError,
  onRefresh
}: {
  agent: WorkflowAgent
  busy: boolean
  config: WorkflowAgentEmbedConfig | null
  onBusy: (busy: boolean) => void
  onConfigChange: (config: WorkflowAgentEmbedConfig) => void
  onError: (error: string | null) => void
  onRefresh: () => Promise<void>
}) {
  const [copied, setCopied] = useState<'script' | 'url' | null>(null)
  const [uploading, setUploading] = useState(false)

  const save = async (updates: Partial<WorkflowAgentEmbedConfig>) => {
    if (!config) {
      return
    }

    onBusy(true)
    onError(null)

    try {
      const next = await updateWorkflowAgentEmbedConfig(agent.id, {
        allowed_origins: updates.allowed_origins ?? config.allowed_origins,
        asset_url: updates.asset_url ?? config.asset_url,
        display_name: updates.display_name ?? config.display_name,
        enabled: updates.enabled ?? config.enabled,
        logo_url: updates.logo_url ?? config.logo_url,
        primary_color: updates.primary_color ?? config.primary_color,
        welcome_message: updates.welcome_message ?? config.welcome_message
      })

      onConfigChange(next)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save embed settings.')
    } finally {
      onBusy(false)
    }
  }

  const copy = async (kind: 'script' | 'url', value: string) => {
    try {
      await writeClipboardText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1600)
      notify({
        kind: 'success',
        message: kind === 'url' ? 'Agent URL copied to clipboard.' : 'Agent embed script copied to clipboard.',
        title: 'Copied'
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not copy to clipboard.'

      onError(message)
      notifyError(err, 'Could not copy to clipboard')
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file || !config) {
      return
    }

    setUploading(true)
    onError(null)

    try {
      const dataUrl = await readFileAsDataUrl(file)
      const next = await uploadWorkflowAgentEmbedAsset(agent.id, { data_url: dataUrl, file_name: file.name })
      onConfigChange(next)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not upload asset.')
    } finally {
      setUploading(false)
    }
  }

  if (!config) {
    return (
      <section className="mt-4 grid min-h-52 place-items-center rounded-md border border-(--stroke-nous)">
        <Loader className="size-8 text-primary" label="Loading embed settings" strokeScale={0.72} type="rose-curve" />
      </section>
    )
  }

  const publicLinkReady = agent.enabled && config.enabled

  return (
    <section className="mt-4 grid gap-3 rounded-md border border-(--stroke-nous) p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold">Embed and share</h3>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Publish this agent as a shareable URL or branded widget for a website.
          </p>
        </div>
        <Button
          disabled={busy || uploading}
          onClick={() => save({ enabled: !config.enabled })}
          size="sm"
          variant="outline"
        >
          <span className={cn('size-1.5 rounded-full', config.enabled ? 'bg-primary' : 'bg-muted-foreground/50')} />
          {config.enabled ? 'Public link enabled' : 'Public link disabled'}
        </Button>
      </div>

      {!agent.enabled ? (
        <div className="rounded-md border border-primary/35 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          This agent is disabled. Enable and save the agent before its public URL or embed script can be used.
        </div>
      ) : null}

      {agent.enabled && !config.enabled ? (
        <div className="rounded-md border border-primary/35 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Public sharing is disabled. Turn on the public link before sharing this URL or installing the embed script.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-xs">
          <span>Display name</span>
          <Input
            disabled={busy}
            onBlur={event => save({ display_name: event.currentTarget.value })}
            onChange={event => onConfigChange({ ...config, display_name: event.currentTarget.value })}
            value={config.display_name}
          />
        </label>
        <label className="grid gap-1.5 text-xs">
          <span>Primary color</span>
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
            <Input
              aria-label="Primary color swatch"
              className="p-1"
              disabled={busy}
              onBlur={event => save({ primary_color: event.currentTarget.value })}
              onChange={event => onConfigChange({ ...config, primary_color: event.currentTarget.value })}
              type="color"
              value={config.primary_color}
            />
            <Input
              disabled={busy}
              onBlur={event => save({ primary_color: event.currentTarget.value })}
              onChange={event => onConfigChange({ ...config, primary_color: event.currentTarget.value })}
              value={config.primary_color}
            />
          </div>
        </label>
      </div>

      <label className="grid gap-1.5 text-xs">
        <span>Welcome message</span>
        <Textarea
          disabled={busy}
          onBlur={event => save({ welcome_message: event.currentTarget.value })}
          onChange={event => onConfigChange({ ...config, welcome_message: event.currentTarget.value })}
          value={config.welcome_message}
        />
      </label>

      <label className="grid gap-1.5 text-xs">
        <span>Allowed origins</span>
        <Textarea
          className="min-h-20 font-mono text-[0.72rem]"
          disabled={busy}
          onBlur={event => save({ allowed_origins: lines(event.currentTarget.value) })}
          onChange={event => onConfigChange({ ...config, allowed_origins: lines(event.currentTarget.value) })}
          placeholder="https://example.com"
          value={config.allowed_origins.join('\n')}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1.5 text-xs">
          <span>Logo or brand asset</span>
          <Input
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={busy || uploading}
            onChange={event => void upload(event.currentTarget.files?.[0])}
            type="file"
          />
        </label>
        <div className="flex items-end">
          {uploading ? (
            <Loader className="size-8 text-primary" label="Uploading asset" strokeScale={0.72} type="rose-curve" />
          ) : config.asset_url ? (
            <img
              alt=""
              className="h-10 w-10 rounded-md border border-(--stroke-nous) object-cover"
              src={config.asset_url}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <Input readOnly value={config.share_url} />
          <Button
            disabled={!config.share_url || !publicLinkReady}
            onClick={() => copy('url', config.share_url)}
            size="sm"
            variant="outline"
          >
            {copied === 'url' ? <CheckCircle2 className="size-4" /> : <Save className="size-4" />}
            {copied === 'url' ? 'Copied' : 'Copy URL'}
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <Textarea className="min-h-20 font-mono text-[0.72rem]" readOnly value={config.embed_script} />
          <Button
            disabled={!config.embed_script || !publicLinkReady}
            onClick={() => copy('script', config.embed_script)}
            size="sm"
            variant="outline"
          >
            {copied === 'script' ? <CheckCircle2 className="size-4" /> : <Save className="size-4" />}
            {copied === 'script' ? 'Copied' : 'Copy script'}
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button disabled={busy || uploading} onClick={() => void onRefresh()} size="sm" variant="ghost">
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>
    </section>
  )
}

function DeliveryPanel({
  agent,
  busy,
  deliveries,
  onBusy,
  onError,
  onRefresh
}: {
  agent: WorkflowAgent
  busy: boolean
  deliveries: WorkflowDelivery[]
  onBusy: (busy: boolean) => void
  onError: (error: string | null) => void
  onRefresh: () => Promise<void>
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WorkflowDelivery | null>(null)
  const [form, setForm] = useState<DeliveryFormState>(() => deliveryFormFromRecord())
  const [page, setPage] = useState(1)
  const visibleDeliveries = deliveries.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(deliveries.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [deliveries.length, page])

  const openCreate = () => {
    setEditing(null)
    setForm(deliveryFormFromRecord())
    setDialogOpen(true)
  }

  const openEdit = (delivery: WorkflowDelivery) => {
    setEditing(delivery)
    setForm(deliveryFormFromRecord(delivery))
    setDialogOpen(true)
  }

  const save = async () => {
    onBusy(true)
    onError(null)

    try {
      const config = JSON.parse(form.configText || '{}') as Record<string, unknown>

      const input = {
        channel: form.channel,
        config,
        delivery_type: form.delivery_type,
        destination: form.destination,
        enabled: form.enabled,
        name: form.name,
        require_approval: form.require_approval,
        template: form.template
      }

      if (editing) {
        await updateWorkflowDelivery(agent.id, editing.id, input)
      } else {
        await createWorkflowDelivery(agent.id, input)
      }

      setDialogOpen(false)
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save delivery. Check the config JSON.')
    } finally {
      onBusy(false)
    }
  }

  const toggle = async (delivery: WorkflowDelivery) => {
    onBusy(true)
    onError(null)

    try {
      await updateWorkflowDelivery(agent.id, delivery.id, { enabled: !delivery.enabled })
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update delivery.')
    } finally {
      onBusy(false)
    }
  }

  const remove = async (delivery: WorkflowDelivery) => {
    onBusy(true)
    onError(null)

    try {
      await deleteWorkflowDelivery(agent.id, delivery.id)
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not delete delivery.')
    } finally {
      onBusy(false)
    }
  }

  return (
    <section className="mt-4 grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">Delivery rules</h3>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Choose where completed agent output is saved, held, or queued.
          </p>
        </div>
        <Button disabled={busy} onClick={openCreate} size="sm">
          <Plus className="size-4" />
          Add delivery
        </Button>
      </div>

      {deliveries.length === 0 ? (
        <div className="grid min-h-32 place-items-center rounded-md border border-dashed border-(--stroke-nous) p-4 text-center">
          <div className="grid gap-2">
            <Send className="mx-auto size-5 text-primary" />
            <p className="text-xs font-medium">No delivery rules yet</p>
            <p className="max-w-md text-[0.7rem] leading-relaxed text-muted-foreground">
              Runs will save output by default. Add delivery when the agent should reply to a source, send a message,
              call Composio, or queue a webhook callback.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {visibleDeliveries.map(delivery => (
            <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3" key={delivery.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        delivery.enabled ? 'bg-primary' : 'bg-muted-foreground/50'
                      )}
                    />
                    {delivery.name || delivery.delivery_type.replace('_', ' ')}
                    {delivery.require_approval ? (
                      <span className="text-[0.65rem] font-normal text-muted-foreground">approval first</span>
                    ) : null}
                  </span>
                  <span className="text-[0.7rem] leading-relaxed text-muted-foreground">
                    {delivery.delivery_type.replace('_', ' ')}
                    {delivery.channel ? ` · ${delivery.channel}` : ''}
                    {delivery.destination ? ` · ${delivery.destination}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button disabled={busy} onClick={() => toggle(delivery)} size="sm" variant="ghost">
                    {delivery.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button disabled={busy} onClick={() => openEdit(delivery)} size="sm" variant="ghost">
                    Edit
                  </Button>
                  <Button disabled={busy} onClick={() => remove(delivery)} size="sm" variant="ghost">
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
          <PaginationControl
            itemLabel="delivery rules"
            onPageChange={setPage}
            page={page}
            pageSize={PANEL_PAGE_SIZE}
            total={deliveries.length}
          />
        </div>
      )}

      <Dialog onOpenChange={open => !busy && setDialogOpen(open)} open={dialogOpen}>
        <DialogContent className="max-w-2xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit delivery' : 'Add delivery'}</DialogTitle>
            <DialogDescription>Configure where this agent sends or stores completed output.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium">
                Type
                <Select
                  disabled={busy}
                  onValueChange={value =>
                    setForm(current => ({ ...current, delivery_type: value as WorkflowDeliveryType }))
                  }
                  value={form.delivery_type}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELIVERY_TYPES.map(item => (
                      <SelectItem key={item} value={item}>
                        {item.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                Name
                <Input
                  disabled={busy}
                  onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                  placeholder="Reply to customer"
                  value={form.name}
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium">
                Channel
                <Input
                  disabled={busy}
                  onChange={event => setForm(current => ({ ...current, channel: event.target.value }))}
                  placeholder="whatsapp / slack / gmail / webhook"
                  value={form.channel}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                Destination
                <Input
                  disabled={busy}
                  onChange={event => setForm(current => ({ ...current, destination: event.target.value }))}
                  placeholder="Phone, email, channel, CRM id, or callback URL"
                  value={form.destination}
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs font-medium">
              Template
              <Textarea
                className="min-h-24"
                disabled={busy}
                onChange={event => setForm(current => ({ ...current, template: event.target.value }))}
                placeholder="Use {{output}}, {{customer.name}}, or payload fields when delivery execution is enabled."
                value={form.template}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              Config JSON
              <Textarea
                className="min-h-24 font-mono text-[0.72rem]"
                disabled={busy}
                onChange={event => setForm(current => ({ ...current, configText: event.target.value }))}
                value={form.configText}
              />
            </label>
            <div className="flex flex-wrap items-center gap-4">
              <button
                className="flex items-center gap-2 text-xs text-muted-foreground"
                disabled={busy}
                onClick={() => setForm(current => ({ ...current, enabled: !current.enabled }))}
                type="button"
              >
                <span className={cn('size-2 rounded-full', form.enabled ? 'bg-primary' : 'bg-muted-foreground/50')} />
                {form.enabled ? 'Enabled' : 'Disabled'}
              </button>
              <button
                className="flex items-center gap-2 text-xs text-muted-foreground"
                disabled={busy}
                onClick={() => setForm(current => ({ ...current, require_approval: !current.require_approval }))}
                type="button"
              >
                <span
                  className={cn('size-2 rounded-full', form.require_approval ? 'bg-primary' : 'bg-muted-foreground/50')}
                />
                {form.require_approval ? 'Approval required' : 'No approval hold'}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={busy} onClick={() => setDialogOpen(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()} type="button">
              {busy ? (
                <Loader className="size-4 text-primary" label="Saving delivery" strokeScale={0.7} type="rose-two" />
              ) : (
                <Save className="size-4" />
              )}
              Save delivery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TriggersPanel({
  agent,
  busy,
  onBusy,
  onError,
  onRefresh,
  triggers
}: {
  agent: WorkflowAgent
  busy: boolean
  onBusy: (busy: boolean) => void
  onError: (error: string | null) => void
  onRefresh: () => Promise<void>
  triggers: WorkflowTrigger[]
}) {
  const [sourceId, setSourceId] = useState<TriggerSourceId>('webhook')
  const [type, setType] = useState<WorkflowTriggerType>('webhook')
  const [eventName, setEventName] = useState('payment.succeeded')
  const [configText, setConfigText] = useState('{}')
  const [name, setName] = useState('')
  const [page, setPage] = useState(1)
  const visibleTriggers = triggers.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(triggers.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, triggers.length])

  const selectSource = (source: (typeof TRIGGER_SOURCES)[number]) => {
    setSourceId(source.id)
    setType(source.triggerType)
    setEventName(source.eventName)
    setName(source.name)
    setConfigText(JSON.stringify(source.config, null, 2))
  }

  const addTrigger = async () => {
    onBusy(true)
    onError(null)

    try {
      const config = JSON.parse(configText || '{}') as Record<string, unknown>

      await createWorkflowTrigger(agent.id, { config, event_name: eventName, name, trigger_type: type })
      setName('')
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create trigger. Check the trigger config JSON.')
    } finally {
      onBusy(false)
    }
  }

  const toggle = async (trigger: WorkflowTrigger) => {
    onBusy(true)
    onError(null)

    try {
      await updateWorkflowTrigger(agent.id, trigger.id, { enabled: !trigger.enabled })
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update trigger.')
    } finally {
      onBusy(false)
    }
  }

  const remove = async (trigger: WorkflowTrigger) => {
    onBusy(true)
    onError(null)

    try {
      await deleteWorkflowTrigger(agent.id, trigger.id)
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not delete trigger.')
    } finally {
      onBusy(false)
    }
  }

  return (
    <section className="mt-4 grid gap-4">
      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <div>
          <h3 className="text-xs font-semibold">Add trigger</h3>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Pick what starts this agent. The selected source fills the trigger type and starter config.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {TRIGGER_SOURCES.map(source => {
            const selected = sourceId === source.id

            return (
              <button
                className={cn(
                  'grid gap-1 rounded-md border border-(--stroke-nous) p-3 text-left transition-colors hover:bg-(--chrome-action-hover)',
                  selected && 'border-primary/45 bg-primary/8'
                )}
                disabled={busy}
                key={source.id}
                onClick={() => selectSource(source)}
                type="button"
              >
                <span className="flex items-center gap-2 text-xs font-medium">
                  <span className={cn('size-2 rounded-full', selected ? 'bg-primary' : 'bg-muted-foreground/45')} />
                  {source.title}
                </span>
                <span className="text-[0.7rem] leading-relaxed text-muted-foreground">{source.description}</span>
              </button>
            )
          })}
        </div>
        <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Select disabled={busy} onValueChange={value => setType(value as WorkflowTriggerType)} value={type}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_TYPES.map(item => (
                <SelectItem key={item} value={item}>
                  {item.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            disabled={busy}
            onChange={event => setEventName(event.target.value)}
            placeholder="payment.succeeded"
            value={eventName}
          />
          <Input
            disabled={busy}
            onChange={event => setName(event.target.value)}
            placeholder="Trigger name"
            value={name}
          />
          <Button disabled={busy} onClick={addTrigger} size="sm">
            {busy ? (
              <Loader className="size-4 text-primary" label="Creating trigger" strokeScale={0.7} type="rose-two" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </div>
        {(sourceId === 'messaging' || sourceId === 'embed') && (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[0.7rem] leading-relaxed text-muted-foreground">
            This trigger source can be configured now, but activation depends on the matching gateway/embed setup in a
            later phase.
          </div>
        )}
        <Textarea
          className="min-h-20 font-mono text-[0.72rem]"
          disabled={busy}
          onChange={event => setConfigText(event.target.value)}
          placeholder='{"appSlug":"airtable"} or {"everyMinutes":60}'
          value={configText}
        />
      </div>

      <div className="grid gap-2">
        {triggers.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-md border border-dashed border-(--stroke-nous) p-4 text-center">
            <div className="grid gap-2">
              <Zap className="mx-auto size-5 text-primary" />
              <p className="text-xs font-medium">No triggers yet</p>
              <p className="max-w-md text-[0.7rem] leading-relaxed text-muted-foreground">
                Add the first source that should start this agent: webhook, schedule, connected app, messaging gateway,
                embed/share, or manual run.
              </p>
            </div>
          </div>
        ) : null}
        {visibleTriggers.map(trigger => (
          <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3" key={trigger.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium">{trigger.name || trigger.event_name || trigger.trigger_type}</p>
                <p className="text-[0.7rem] text-muted-foreground">
                  {trigger.trigger_type} · {trigger.enabled ? 'enabled' : 'disabled'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button disabled={busy} onClick={() => void toggle(trigger)} size="sm" variant="ghost">
                  {trigger.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button disabled={busy} onClick={() => void remove(trigger)} size="sm" variant="ghost">
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </div>
            </div>
            {trigger.trigger_type === 'webhook' ? (
              <div className="grid gap-1 rounded-md bg-muted/35 p-2 font-mono text-[0.68rem] text-muted-foreground">
                <span className="wrap-anywhere">URL: {trigger.webhook_url}</span>
                <span className="wrap-anywhere">Secret header: X-Verxio-Webhook-Secret: {trigger.secret}</span>
              </div>
            ) : null}
            {Object.keys(trigger.config || {}).length > 0 ? (
              <pre className="overflow-x-auto rounded-md bg-muted/35 p-2 text-[0.68rem] text-muted-foreground">
                {JSON.stringify(trigger.config, null, 2)}
              </pre>
            ) : null}
          </div>
        ))}
        {triggers.length > 0 ? (
          <PaginationControl
            itemLabel="triggers"
            onPageChange={setPage}
            page={page}
            pageSize={PANEL_PAGE_SIZE}
            total={triggers.length}
          />
        ) : null}
      </div>
    </section>
  )
}

function RunsPanel({
  agent,
  busy,
  onBusy,
  onError,
  onRefresh,
  runs
}: {
  agent: WorkflowAgent
  busy: boolean
  onBusy: (busy: boolean) => void
  onError: (error: string | null) => void
  onRefresh: () => Promise<void>
  runs: WorkflowRun[]
}) {
  const [input, setInput] = useState('{\n  "example": true\n}')
  const [eventsByRunId, setEventsByRunId] = useState<Record<string, WorkflowRunEvent[]>>({})
  const [loadingEventsRunId, setLoadingEventsRunId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const visibleRuns = runs.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(runs.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, runs.length])

  const run = async () => {
    let parsed: Record<string, unknown>

    try {
      parsed = JSON.parse(input) as Record<string, unknown>
    } catch {
      onError('Manual run input must be valid JSON.')

      return
    }

    onBusy(true)
    onError(null)

    try {
      await runWorkflowAgent(agent.id, parsed)
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not run agent.')
    } finally {
      onBusy(false)
    }
  }

  const loadEvents = async (runId: string) => {
    if (eventsByRunId[runId] || loadingEventsRunId === runId) {
      return
    }

    setLoadingEventsRunId(runId)
    onError(null)

    try {
      const result = await listWorkflowRunEvents(agent.id, runId)

      setEventsByRunId(current => ({ ...current, [runId]: result.events }))
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load run events.')
    } finally {
      setLoadingEventsRunId(null)
    }
  }

  return (
    <section className="mt-4 grid gap-4">
      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <h3 className="text-xs font-semibold">Manual run</h3>
        <Textarea
          className="min-h-28 font-mono text-xs"
          disabled={busy}
          onChange={event => setInput(event.target.value)}
          value={input}
        />
        <Button className="w-fit" disabled={busy} onClick={run} size="sm">
          {busy ? (
            <Loader className="size-4 text-primary" label="Running agent" strokeScale={0.7} type="rose-two" />
          ) : (
            <Send className="size-4" />
          )}
          Run agent
        </Button>
      </div>
      <div className="grid gap-2">
        {runs.length === 0 ? <p className="text-xs text-muted-foreground">No runs yet.</p> : null}
        {visibleRuns.map(run => (
          <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3" key={run.id}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-medium">
                {run.status === 'completed' ? (
                  <CheckCircle2 className="size-4 text-primary" />
                ) : run.status === 'failed' ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : (
                  <Zap className="size-4 text-primary" />
                )}
                {run.trigger_type} · {run.status}
              </p>
              <span className="text-[0.68rem] text-muted-foreground">{formatDate(run.created_at)}</span>
            </div>
            {run.output_text ? <p className="text-xs leading-relaxed text-foreground/90">{run.output_text}</p> : null}
            {run.error ? <p className="text-xs leading-relaxed text-destructive">{run.error}</p> : null}
            <details className="text-[0.68rem] text-muted-foreground">
              <summary className="cursor-pointer">Input</summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted/35 p-2">
                {JSON.stringify(run.input, null, 2)}
              </pre>
            </details>
            <details
              className="text-[0.68rem] text-muted-foreground"
              onToggle={event => {
                if (event.currentTarget.open) {
                  void loadEvents(run.id)
                }
              }}
            >
              <summary className="cursor-pointer">Events</summary>
              <div className="mt-2 grid gap-2 rounded-md bg-muted/35 p-2">
                {loadingEventsRunId === run.id ? (
                  <Loader
                    className="size-4 text-primary"
                    label="Loading run events"
                    strokeScale={0.7}
                    type="rose-two"
                  />
                ) : null}
                {(eventsByRunId[run.id] || []).map(event => (
                  <div className="grid gap-1 border-l-2 border-primary/45 pl-2" key={event.id}>
                    <span className="font-medium text-foreground/90">
                      {event.event_type} · {formatDate(event.created_at)}
                    </span>
                    {event.message ? <span>{event.message}</span> : null}
                    {Object.keys(event.metadata || {}).length > 0 ? (
                      <pre className="overflow-x-auto rounded-md bg-background/70 p-2">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
        {runs.length > 0 ? (
          <PaginationControl
            itemLabel="runs"
            onPageChange={setPage}
            page={page}
            pageSize={PANEL_PAGE_SIZE}
            total={runs.length}
          />
        ) : null}
      </div>
    </section>
  )
}
