import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { PageLoader } from '@/components/page-loader'
import { SkillEditorDialog } from '@/components/skill-editor-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { writeClipboardText } from '@/components/ui/copy-button'
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
import { getMessagingPlatforms, type MessagingPlatformInfo } from '@/hermes'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Zap
} from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  type ComposioApp,
  type ComposioConnectedAccount,
  type ComposioToolPreview,
  type ComposioTriggerType,
  createKnowledgeBase,
  createKnowledgeDocument,
  createWorkflowAgent,
  createWorkflowCustomTool,
  createWorkflowDelivery,
  createWorkflowTrigger,
  deleteKnowledgeBase,
  deleteWorkflowAgent,
  deleteWorkflowAgentSetupDraft,
  deleteWorkflowDelivery,
  deleteWorkflowTrigger,
  draftWorkflowAgentSetup,
  draftWorkflowAgentSetupUpdate,
  getPublicWorkflowAgent,
  getWorkflowAgentEmbedConfig,
  type KnowledgeBase,
  listComposioApps,
  listComposioAppTools,
  listComposioConnections,
  listComposioTriggerTypes,
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
  type SdrFunnelRules,
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
import { SdrContactsPanel } from './sdr-contacts-panel'
import { SdrFunnelEditor } from './sdr-funnel-editor'

type AgentTab =
  | 'instructions'
  | 'skills'
  | 'knowledge'
  | 'integrations'
  | 'tools'
  | 'delivery'
  | 'triggers'
  | 'funnel'
  | 'contacts'
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
  { id: 'funnel', label: 'Funnel' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'embed', label: 'Embed' },
  { id: 'runs', label: 'Runs' }
]

function isDefaultAgent(agent: WorkflowAgent | null | undefined): boolean {
  return Boolean(agent?.tags?.includes('default'))
}

function isSdrAgent(agent: WorkflowAgent | null | undefined): boolean {
  return Boolean(agent?.tags?.includes('sdr'))
}

type TriggerSourceId = 'app_event' | 'embed' | 'manual' | 'messaging' | 'schedule' | 'webhook'

const TRIGGER_SOURCES: Array<{
  description: string
  eventName: string
  id: TriggerSourceId
  name: string
  title: string
  triggerType: WorkflowTriggerType
}> = [
  {
    description: 'Start from the Run button or a direct in-app test.',
    eventName: 'manual.run',
    id: 'manual',
    name: 'Manual run',
    title: 'Manual',
    triggerType: 'manual'
  },
  {
    description: 'Receive JSON from payments, forms, backend APIs, or external systems.',
    eventName: 'external.event',
    id: 'webhook',
    name: 'External webhook',
    title: 'Webhook/API',
    triggerType: 'webhook'
  },
  {
    description: 'Run on an interval or cron-like schedule.',
    eventName: 'scheduled.run',
    id: 'schedule',
    name: 'Scheduled run',
    title: 'Schedule',
    triggerType: 'schedule'
  },
  {
    description: 'Start from a connected Composio app event such as CRM, email, or forms.',
    eventName: '',
    id: 'app_event',
    name: 'Connected app event',
    title: 'Connected app',
    triggerType: 'app_event'
  },
  {
    description: 'Start from WhatsApp, Telegram, Slack, Discord, or email inbound messages.',
    eventName: 'message.received',
    id: 'messaging',
    name: 'Messaging gateway',
    title: 'Messaging gateway',
    triggerType: 'chat'
  },
  {
    description: 'Start when a website widget or share page submits input.',
    eventName: 'embed.submitted',
    id: 'embed',
    name: 'Embed or share form',
    title: 'Embed/share',
    triggerType: 'api'
  }
]

const DELIVERY_TYPES: Array<{
  description: string
  label: string
  value: WorkflowDeliveryType
}> = [
  {
    value: 'save_only',
    label: 'Save with the run',
    description: 'Keep the completed report in Verxio without sending it externally.'
  },
  {
    value: 'reply_to_source',
    label: 'Reply to trigger source',
    description: 'Reply through the same messaging connection and conversation that started the run.'
  },
  {
    value: 'send_message',
    label: 'Messaging gateway',
    description: 'Send through a configured Telegram, Slack, Discord, WhatsApp, or other gateway.'
  },
  {
    value: 'composio_action',
    label: 'Connected app',
    description: 'Deliver through a connected app action, such as sending a Gmail message.'
  },
  {
    value: 'webhook_callback',
    label: 'Webhook callback',
    description: 'POST the completed report to another HTTP endpoint.'
  },
  {
    value: 'approval_first',
    label: 'Hold for approval',
    description: 'Save the report and wait for approval before any external delivery.'
  }
]

const AGENT_PAGE_SIZE = 8
const PANEL_PAGE_SIZE = 6
const AGENT_DRAFT_ROUTE_SEGMENT = 'drafts'

const COMPOSIO_APP_DISPLAY_NAMES: Record<string, string> = {
  airtable: 'Airtable',
  discord: 'Discord',
  gmail: 'Gmail',
  googledocs: 'Google Docs',
  googledrive: 'Google Drive',
  googleforms: 'Google Forms',
  googlesheets: 'Google Sheets',
  hubspot: 'HubSpot',
  notion: 'Notion',
  slack: 'Slack',
  stripe: 'Stripe',
  whatsapp: 'WhatsApp'
}

function normalizeComposioSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '')
}

function connectedAppDisplayName(appSlug: string, apps: ComposioApp[]): string {
  const normalized = normalizeComposioSlug(appSlug)
  const catalogName = apps.find(app => normalizeComposioSlug(app.slug) === normalized)?.name.trim()

  if (catalogName) {
    return catalogName
  }

  if (COMPOSIO_APP_DISPLAY_NAMES[normalized]) {
    return COMPOSIO_APP_DISPLAY_NAMES[normalized]
  }

  return appSlug
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

interface DraftState {
  approval_policy: string
  campaign_context: string
  description: string
  enabled: boolean
  fallback_email: string
  funnel_rules: SdrFunnelRules
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
    campaign_context: agent?.campaign_context ?? '',
    description: agent?.description ?? '',
    enabled: agent?.enabled ?? true,
    fallback_email: agent?.fallback_email ?? '',
    funnel_rules: agent?.funnel_rules?.rules ? agent.funnel_rules : { rules: [] },
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
    campaign_context: agent.campaign_context ?? '',
    description: agent.description ?? '',
    enabled: agent.enabled ?? true,
    fallback_email: agent.fallback_email ?? '',
    funnel_rules: agent.funnel_rules?.rules ? agent.funnel_rules : { rules: [] },
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

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; kind: 'agent' | 'draft'; name: string } | null>(null)

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
      campaign_context: draft.campaign_context,
      description: draft.description,
      enabled: draft.enabled,
      fallback_email: draft.fallback_email,
      funnel_rules: draft.funnel_rules,
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

  const removeAgent = async (agentId: string, name: string) => {
    setBusy(true)
    setError(null)

    try {
      await deleteWorkflowAgent(agentId)
      setAgents(current => current.filter(agent => agent.id !== agentId))

      if (selectedId === agentId) {
        setSelectedId(null)
        setDraft(draftFromAgent())
        navigate(AGENTS_ROUTE)
      }

      notify({ kind: 'success', message: name, title: 'Agent deleted' })
    } catch (err) {
      const message = 'Could not delete agent'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
      throw err instanceof Error ? err : new Error(message)
    } finally {
      setBusy(false)
    }
  }

  const removeSetupDraft = async (draftId: string, name: string) => {
    setBusy(true)
    setError(null)

    try {
      await deleteWorkflowAgentSetupDraft(draftId)
      setSetupDrafts(current => current.filter(setupDraft => setupDraft.id !== draftId))

      if (selectedDraftId === draftId) {
        setSelectedDraftId(null)
        setSetupDraftResponse(null)
        setDraft(draftFromAgent())
        navigate(AGENTS_ROUTE)
      }

      notify({ kind: 'success', message: name, title: 'Draft deleted' })
    } catch (err) {
      const message = 'Could not delete draft'

      setError(err instanceof Error ? err.message : `${message}.`)
      notifyError(err, message)
      throw err instanceof Error ? err : new Error(message)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return
    }

    if (deleteTarget.kind === 'agent') {
      await removeAgent(deleteTarget.id, deleteTarget.name)

      return
    }

    await removeSetupDraft(deleteTarget.id, deleteTarget.name)
  }

  const requestDeleteSelected = () => {
    if (selected) {
      setDeleteTarget({ id: selected.id, kind: 'agent', name: selected.name })

      return
    }

    if (selectedSetupDraft) {
      setDeleteTarget({
        id: selectedSetupDraft.id,
        kind: 'draft',
        name: selectedSetupDraft.draft.agent.name || 'Untitled draft'
      })
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
              onDeleteAgent={agent => setDeleteTarget({ id: agent.id, kind: 'agent', name: agent.name })}
              onDeleteDraft={setupDraft =>
                setDeleteTarget({
                  id: setupDraft.id,
                  kind: 'draft',
                  name: setupDraft.draft.agent.name || 'Untitled draft'
                })
              }
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
                onDelete={selected || selectedSetupDraft ? requestDeleteSelected : undefined}
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
                  {tab === 'contacts' && isSdrAgent(selected) ? (
                    <SdrContactsPanel agentId={selected.id} agentName={selected.name} />
                  ) : null}
                </>
              ) : (
                <AgentSaveRequired tab={tab} />
              )}
            </main>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        busyLabel="Deleting…"
        confirmLabel="Delete"
        description={
          deleteTarget?.kind === 'draft'
            ? 'This removes the unfinished setup draft. This cannot be undone.'
            : 'This permanently removes the agent and its triggers, deliveries, and runs from this workspace.'
        }
        destructive
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        open={Boolean(deleteTarget)}
        title={
          deleteTarget?.kind === 'draft'
            ? `Delete draft “${deleteTarget.name}”?`
            : `Delete agent “${deleteTarget?.name ?? ''}”?`
        }
      />
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
      <span className="inline-flex items-center justify-center gap-1.5">
        Powered by
        <a
          aria-label="Verxio"
          className="inline-flex h-5 w-[4.75rem] align-middle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          href={VERXIO_WEBSITE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <VerxioWordmark
            className="w-full"
            style={{ '--fit-text-line-height': '0.9', '--fit-text-min': '1.05rem' } as CSSProperties}
            variant="brand"
          />
        </a>
      </span>
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
  onDeleteAgent,
  onDeleteDraft,
  onSelectAgent,
  onSelectDraft
}: {
  items: AgentListItem[]
  onCreate: () => void
  onDeleteAgent: (agent: WorkflowAgent) => void
  onDeleteDraft: (setupDraft: WorkflowAgentSetupDraft) => void
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
          <div
            className="relative grid min-h-28 content-between gap-3 rounded-md border border-primary/40 p-4 text-left transition-colors hover:border-primary/60 hover:bg-(--chrome-action-hover)"
            key={`${item.type}:${item.id}`}
          >
            <button
              className="absolute inset-0 rounded-md focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => (item.type === 'agent' ? onSelectAgent(item.id) : onSelectDraft(item.id))}
              type="button"
            >
              <span className="sr-only">Open {item.agent?.name || item.draft?.draft.agent.name || 'item'}</span>
            </button>
            <div className="relative z-10 pointer-events-none grid gap-3">
              {item.agent ? <AgentListAgentCard agent={item.agent} /> : null}
              {item.draft ? <AgentListDraftCard setupDraft={item.draft} /> : null}
            </div>
            <div className="relative z-10 flex justify-end">
              <Button
                className="pointer-events-auto"
                onClick={event => {
                  event.stopPropagation()

                  if (item.agent) {
                    onDeleteAgent(item.agent)

                    return
                  }

                  if (item.draft) {
                    onDeleteDraft(item.draft)
                  }
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </div>
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
          {isDefaultAgent(agent) ? (
            <span className="rounded-full border border-primary/25 bg-primary/8 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
              (default)
            </span>
          ) : null}
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
        {AGENT_TABS.filter(item => {
          if (item.id === 'funnel' || item.id === 'contacts') {
            return isSdrAgent(selected)
          }
          return true
        }).map(item => (
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
          <label className="grid gap-1.5 text-xs font-medium">
            Fallback email
            <Input
              disabled={busy}
              onChange={event => patch({ fallback_email: event.target.value })}
              placeholder="support@example.com"
              value={draft.fallback_email}
            />
          </label>
          {isSdrAgent(selected) ? (
            <label className="grid gap-1.5 text-xs font-medium">
              Campaign context
              <Textarea
                className="min-h-24"
                disabled={busy}
                onChange={event => patch({ campaign_context: event.target.value })}
                placeholder="Offer, audience, and talking points the SDR should use after the funnel."
                value={draft.campaign_context}
              />
            </label>
          ) : null}
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
      {tab === 'funnel' && isSdrAgent(selected) ? (
        <SdrFunnelEditor
          disabled={busy}
          onChange={funnel_rules => patch({ funnel_rules })}
          value={draft.funnel_rules}
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
    funnel: {
      description: 'Create the SDR agent first, then add keyword triggers, qualification questions, and follow-ups.',
      title: 'Save before editing the funnel'
    },
    contacts: {
      description: 'Create the SDR agent first. Inbound WhatsApp and Telegram chats will show up here.',
      title: 'Save before viewing contacts'
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
  action: string
  channel: string
  connectedAccountId: string
  connectionId: string
  configText: string
  delivery_type: WorkflowDeliveryType
  destination: string
  enabled: boolean
  name: string
  require_approval: boolean
  subject: string
  template: string
}

function deliveryFormFromRecord(delivery?: WorkflowDelivery | null): DeliveryFormState {
  const config = delivery?.config ?? {}
  const argumentsValue = typeof config.arguments === 'object' && config.arguments !== null ? config.arguments : {}

  return {
    action: String(config.action ?? ''),
    channel: delivery?.channel ?? '',
    connectedAccountId: String(config.connectedAccountId ?? config.connected_account_id ?? ''),
    connectionId: String(config.connectionId ?? config.connection_id ?? 'default'),
    configText: JSON.stringify(argumentsValue, null, 2),
    delivery_type: delivery?.delivery_type ?? 'save_only',
    destination: delivery?.destination ?? '',
    enabled: delivery?.enabled ?? true,
    name: delivery?.name ?? '',
    require_approval: delivery?.require_approval ?? false,
    subject: String((argumentsValue as Record<string, unknown>).subject ?? ''),
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
  const [connectedAccounts, setConnectedAccounts] = useState<ComposioConnectedAccount[]>([])
  const [composioApps, setComposioApps] = useState<ComposioApp[]>([])
  const [messagingPlatforms, setMessagingPlatforms] = useState<MessagingPlatformInfo[]>([])
  const [appTools, setAppTools] = useState<ComposioToolPreview[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const visibleDeliveries = deliveries.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)
  const selectedDeliveryType = DELIVERY_TYPES.find(item => item.value === form.delivery_type) ?? DELIVERY_TYPES[0]
  const selectedAccount = connectedAccounts.find(account => account.id === form.connectedAccountId)
  const selectedAppTool = appTools.find(tool => tool.slug === form.action)

  const appActionProperties =
    selectedAppTool?.inputParameters &&
    typeof selectedAppTool.inputParameters.properties === 'object' &&
    selectedAppTool.inputParameters.properties !== null
      ? (selectedAppTool.inputParameters.properties as Record<string, Record<string, unknown>>)
      : {}

  const appActionRequired = Array.isArray(selectedAppTool?.inputParameters?.required)
    ? selectedAppTool.inputParameters.required.map(String)
    : []

  const managedAppActionKeys =
    form.action === 'GMAIL_SEND_EMAIL' ? new Set(['body', 'recipient_email', 'subject']) : new Set<string>()

  const visibleAppActionProperties = Object.entries(appActionProperties).filter(
    ([key]) => !managedAppActionKeys.has(key)
  )

  const appActionArguments = useMemo(() => {
    try {
      const parsed = JSON.parse(form.configText || '{}') as unknown

      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }, [form.configText])

  const messagingOptions = useMemo(
    () =>
      messagingPlatforms.flatMap(platform => {
        if (!platform.configured || !platform.enabled) {
          return []
        }

        const connections = (platform.connections ?? []).filter(
          connection => connection.configured && connection.enabled
        )

        if (connections.length === 0) {
          return [{ id: `${platform.id}::default`, label: platform.name, platformId: platform.id }]
        }

        return connections.map(connection => ({
          id: `${platform.id}::${connection.id}`,
          label: `${platform.name} · ${connection.label}`,
          platformId: platform.id
        }))
      }),
    [messagingPlatforms]
  )

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(deliveries.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [deliveries.length, page])

  useEffect(() => {
    let active = true
    void Promise.allSettled([getMessagingPlatforms(), listComposioConnections(), listComposioApps()]).then(
      ([gatewaysResult, accountsResult, appsResult]) => {
        if (!active) {
          return
        }

        const errors: string[] = []

        if (gatewaysResult.status === 'fulfilled') {
          setMessagingPlatforms(gatewaysResult.value.platforms)
        } else {
          errors.push('messaging gateways')
        }

        if (accountsResult.status === 'fulfilled') {
          setConnectedAccounts(
            accountsResult.value.accounts.filter(account => account.status.toUpperCase() === 'ACTIVE')
          )
        } else {
          errors.push('connected apps')
        }

        if (appsResult.status === 'fulfilled') {
          setComposioApps(appsResult.value.apps)
        }

        setSourcesError(errors.length ? `Could not load ${errors.join(' or ')}.` : null)
        setSourcesLoading(false)
      }
    )

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    setAppTools([])

    if (!selectedAccount) {
      return () => {
        active = false
      }
    }

    void listComposioAppTools(selectedAccount.appSlug, 100)
      .then(result => {
        if (active) {
          setAppTools(result.tools)
        }
      })
      .catch(() => {
        if (active) {
          setSourcesError(`Could not load ${connectedAppDisplayName(selectedAccount.appSlug, composioApps)} actions.`)
        }
      })

    return () => {
      active = false
    }
  }, [composioApps, selectedAccount])

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

  const setAppActionArgument = (key: string, value: string) => {
    setForm(current => {
      let argumentsValue: Record<string, unknown> = {}

      try {
        const parsed = JSON.parse(current.configText || '{}') as unknown

        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          argumentsValue = parsed as Record<string, unknown>
        }
      } catch {
        // Replace malformed advanced JSON once a schema-backed field is edited.
      }

      return {
        ...current,
        configText: JSON.stringify({ ...argumentsValue, [key]: value }, null, 2)
      }
    })
  }

  const save = async () => {
    onBusy(true)
    onError(null)

    try {
      const config: Record<string, unknown> = { version: 1 }
      let channel = form.channel
      let destination = form.destination

      if (form.delivery_type === 'send_message') {
        const connection = messagingOptions.find(item => item.id === `${form.channel}::${form.connectionId}`)

        if (!connection) {
          throw new Error('Select a configured messaging connection.')
        }

        if (!destination.trim()) {
          throw new Error('Enter the destination channel, chat, phone number, or email address.')
        }

        config.connectionId = form.connectionId
      } else if (form.delivery_type === 'reply_to_source') {
        channel = ''
        destination = 'trigger.source'
      } else if (form.delivery_type === 'composio_action') {
        const account = connectedAccounts.find(item => item.id === form.connectedAccountId)

        if (!account || !form.action) {
          throw new Error('Select a connected app and delivery action.')
        }

        const rawArguments = JSON.parse(form.configText || '{}') as Record<string, unknown>

        const managedGmailKeys =
          form.action === 'GMAIL_SEND_EMAIL' ? new Set(['body', 'recipient_email', 'subject']) : new Set<string>()

        const schemaArguments = Object.fromEntries(
          Object.entries(appActionProperties).flatMap<[string, unknown]>(([key, schema]) => {
            if (managedGmailKeys.has(key)) {
              return []
            }

            const rawValue = rawArguments[key]

            if (rawValue === undefined || rawValue === null || rawValue === '') {
              if (appActionRequired.includes(key)) {
                throw new Error(`${String(schema.title || key)} is required.`)
              }

              return []
            }

            if (typeof rawValue !== 'string') {
              return [[key, rawValue]]
            }

            if (schema.type === 'number' || schema.type === 'integer') {
              const value = Number(rawValue)

              if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
                throw new Error(`${String(schema.title || key)} must be a number.`)
              }

              return [[key, value]]
            }

            if (schema.type === 'boolean') {
              return [[key, rawValue === 'true']]
            }

            if (schema.type === 'array' || schema.type === 'object') {
              try {
                const value: unknown = JSON.parse(rawValue)

                if (
                  (schema.type === 'array' && !Array.isArray(value)) ||
                  (schema.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value)))
                ) {
                  throw new Error('type mismatch')
                }

                return [[key, value]]
              } catch {
                throw new Error(`${String(schema.title || key)} must be valid JSON.`)
              }
            }

            return [[key, rawValue]]
          })
        )

        const argumentsValue = Object.keys(appActionProperties).length > 0 ? schemaArguments : rawArguments

        if (normalizeComposioSlug(account.appSlug) === 'gmail' && form.subject.trim()) {
          argumentsValue.subject = form.subject.trim()
        }

        if (form.action === 'GMAIL_SEND_EMAIL' && !destination.trim()) {
          throw new Error('Enter the Gmail recipient email address.')
        }

        channel = account.appSlug
        config.appSlug = account.appSlug
        config.connectedAccountId = account.id
        config.action = form.action
        config.arguments = argumentsValue
      } else if (form.delivery_type === 'webhook_callback') {
        if (!destination.startsWith('https://') && !destination.startsWith('http://')) {
          throw new Error('Enter a valid HTTP or HTTPS callback URL.')
        }

        channel = 'webhook'
        config.url = destination
      } else {
        channel = ''
        destination = ''
      }

      const input = {
        channel,
        config,
        delivery_type: form.delivery_type,
        destination,
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
            Send completed reports through a messaging connection, connected app, or webhook.
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
              Runs save output by default. Add a rule to deliver the report automatically when a run completes.
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
            {sourcesError ? (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                {sourcesError} Refresh the page after checking the related setup.
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium" htmlFor="delivery-type">
                  Delivery method
                </label>
                <Select
                  disabled={busy || sourcesLoading}
                  onValueChange={value => {
                    const deliveryType = value as WorkflowDeliveryType
                    setForm(current => ({
                      ...current,
                      action: deliveryType === 'composio_action' ? current.action : '',
                      channel: deliveryType === 'send_message' ? current.channel : '',
                      connectedAccountId: deliveryType === 'composio_action' ? current.connectedAccountId : '',
                      connectionId: deliveryType === 'send_message' ? current.connectionId : 'default',
                      delivery_type: deliveryType,
                      destination:
                        deliveryType === 'reply_to_source'
                          ? 'trigger.source'
                          : deliveryType === current.delivery_type
                            ? current.destination
                            : ''
                    }))
                  }}
                  value={form.delivery_type}
                >
                  <SelectTrigger id="delivery-type" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent avoidCollisions={false} side="bottom">
                    {DELIVERY_TYPES.map(item => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                  {selectedDeliveryType.description}
                </p>
              </div>
              <div className="grid content-start gap-1.5">
                <label className="text-xs font-medium" htmlFor="delivery-name">
                  Rule name
                </label>
                <Input
                  disabled={busy}
                  id="delivery-name"
                  onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                  placeholder="Daily team report"
                  value={form.name}
                />
              </div>
            </div>

            {form.delivery_type === 'send_message' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium" htmlFor="delivery-gateway">
                    Messaging connection
                  </label>
                  <Select
                    disabled={busy || sourcesLoading || messagingOptions.length === 0}
                    onValueChange={value => {
                      const [channel, connectionId] = value.split('::')
                      setForm(current => ({ ...current, channel, connectionId }))
                    }}
                    value={form.channel ? `${form.channel}::${form.connectionId}` : ''}
                  >
                    <SelectTrigger id="delivery-gateway" size="sm">
                      <SelectValue
                        placeholder={sourcesLoading ? 'Loading connections…' : 'Select a messaging connection'}
                      />
                    </SelectTrigger>
                    <SelectContent avoidCollisions={false} side="bottom">
                      {messagingOptions.map(option => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {messagingOptions.length === 0 && !sourcesLoading ? (
                    <p className="text-[0.7rem] text-muted-foreground">
                      Configure and enable a connection in Messaging first.
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium" htmlFor="delivery-destination">
                    Destination
                  </label>
                  <Input
                    disabled={busy}
                    id="delivery-destination"
                    onChange={event => setForm(current => ({ ...current, destination: event.target.value }))}
                    placeholder="Chat, channel, phone number, or user ID"
                    value={form.destination}
                  />
                  <p className="text-[0.7rem] text-muted-foreground">
                    Use the platform&apos;s native destination ID. Telegram topics support chatId:threadId.
                  </p>
                </div>
              </div>
            ) : null}

            {form.delivery_type === 'reply_to_source' ? (
              <div className="rounded-md border border-(--stroke-nous) bg-muted/30 p-3 text-xs">
                Verxio will use the platform, connection, conversation, and thread from the message that triggered this
                run.
              </div>
            ) : null}

            {form.delivery_type === 'composio_action' ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium" htmlFor="delivery-app-account">
                      Connected app
                    </label>
                    <Select
                      disabled={busy || sourcesLoading || connectedAccounts.length === 0}
                      onValueChange={connectedAccountId =>
                        setForm(current => ({ ...current, action: '', connectedAccountId }))
                      }
                      value={form.connectedAccountId}
                    >
                      <SelectTrigger id="delivery-app-account" size="sm">
                        <SelectValue placeholder="Select a connected account" />
                      </SelectTrigger>
                      <SelectContent avoidCollisions={false} side="bottom">
                        {connectedAccounts.map(account => (
                          <SelectItem key={account.id} value={account.id}>
                            {connectedAppDisplayName(account.appSlug, composioApps)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium" htmlFor="delivery-app-action">
                      Delivery action
                    </label>
                    <Select
                      disabled={busy || !selectedAccount || appTools.length === 0}
                      onValueChange={action => setForm(current => ({ ...current, action, configText: '{}' }))}
                      value={form.action}
                    >
                      <SelectTrigger id="delivery-app-action" size="sm">
                        <SelectValue placeholder="Select an action" />
                      </SelectTrigger>
                      <SelectContent avoidCollisions={false} side="bottom">
                        {appTools.map(tool => (
                          <SelectItem key={tool.slug} value={tool.slug}>
                            {tool.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {normalizeComposioSlug(selectedAccount?.appSlug ?? '') === 'gmail' &&
                form.action === 'GMAIL_SEND_EMAIL' ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium" htmlFor="delivery-email-recipient">
                        Recipient email
                      </label>
                      <Input
                        autoComplete="email"
                        disabled={busy}
                        id="delivery-email-recipient"
                        onChange={event => setForm(current => ({ ...current, destination: event.target.value }))}
                        placeholder="team@example.com"
                        type="email"
                        value={form.destination}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-medium" htmlFor="delivery-email-subject">
                        Subject
                      </label>
                      <Input
                        disabled={busy}
                        id="delivery-email-subject"
                        onChange={event => setForm(current => ({ ...current, subject: event.target.value }))}
                        placeholder="Daily team report"
                        value={form.subject}
                      />
                    </div>
                  </div>
                ) : null}
                {visibleAppActionProperties.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {visibleAppActionProperties.map(([key, schema]) => (
                      <div className="grid gap-1.5" key={key}>
                        <label className="text-xs font-medium" htmlFor={`delivery-action-${key}`}>
                          {String(schema.title || key)}
                          {!appActionRequired.includes(key) ? (
                            <span className="font-normal text-muted-foreground"> (optional)</span>
                          ) : null}
                        </label>
                        {Array.isArray(schema.enum) && schema.enum.length > 0 ? (
                          <Select
                            disabled={busy}
                            onValueChange={value => setAppActionArgument(key, value)}
                            value={String(appActionArguments[key] ?? '')}
                          >
                            <SelectTrigger id={`delivery-action-${key}`} size="sm">
                              <SelectValue placeholder={`Select ${String(schema.title || key).toLowerCase()}`} />
                            </SelectTrigger>
                            <SelectContent avoidCollisions={false} side="bottom">
                              {schema.enum.map(value => (
                                <SelectItem key={String(value)} value={String(value)}>
                                  {String(value)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : schema.type === 'boolean' ? (
                          <Select
                            disabled={busy}
                            onValueChange={value => setAppActionArgument(key, value)}
                            value={String(appActionArguments[key] ?? '')}
                          >
                            <SelectTrigger id={`delivery-action-${key}`} size="sm">
                              <SelectValue placeholder="Select true or false" />
                            </SelectTrigger>
                            <SelectContent avoidCollisions={false} side="bottom">
                              <SelectItem value="true">True</SelectItem>
                              <SelectItem value="false">False</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : schema.type === 'array' || schema.type === 'object' ? (
                          <Textarea
                            className="min-h-20 font-mono text-[0.72rem]"
                            disabled={busy}
                            id={`delivery-action-${key}`}
                            onChange={event => setAppActionArgument(key, event.target.value)}
                            placeholder={schema.type === 'array' ? '[]' : '{}'}
                            value={String(appActionArguments[key] ?? '')}
                          />
                        ) : (
                          <Input
                            disabled={busy}
                            id={`delivery-action-${key}`}
                            inputMode={schema.type === 'number' || schema.type === 'integer' ? 'decimal' : undefined}
                            onChange={event => setAppActionArgument(key, event.target.value)}
                            placeholder={String(schema.description || '')}
                            value={String(appActionArguments[key] ?? '')}
                          />
                        )}
                        {schema.description ? (
                          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                            {String(schema.description)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : selectedAppTool && Object.keys(selectedAppTool.inputParameters ?? {}).length === 0 ? (
                  <label className="grid gap-1.5 text-xs font-medium">
                    Action arguments (JSON)
                    <Textarea
                      className="min-h-24 font-mono text-[0.72rem]"
                      disabled={busy}
                      onChange={event => setForm(current => ({ ...current, configText: event.target.value }))}
                      value={form.configText}
                    />
                    <span className="font-normal text-muted-foreground">
                      Values can include the same report variables as the output template.
                    </span>
                  </label>
                ) : null}
              </>
            ) : null}

            {form.delivery_type === 'webhook_callback' ? (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium" htmlFor="delivery-webhook-url">
                  Callback URL
                </label>
                <Input
                  disabled={busy}
                  id="delivery-webhook-url"
                  onChange={event => setForm(current => ({ ...current, destination: event.target.value }))}
                  placeholder="https://example.com/hooks/report"
                  type="url"
                  value={form.destination}
                />
              </div>
            ) : null}

            {!['save_only', 'approval_first'].includes(form.delivery_type) ? (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium" htmlFor="delivery-template">
                  Output template <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Textarea
                  className="min-h-24"
                  disabled={busy}
                  id="delivery-template"
                  onChange={event => setForm(current => ({ ...current, template: event.target.value }))}
                  placeholder="{{agent.output}}"
                  value={form.template}
                />
                <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                  Leave blank to deliver the agent&apos;s report exactly as returned. Use {'{{agent.output}}'},{' '}
                  {'{{run.id}}'}, or input fields such as {'{{input.customer.name}}'} to add a stable wrapper.
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={form.enabled}
                  disabled={busy}
                  onCheckedChange={enabled => setForm(current => ({ ...current, enabled }))}
                  size="xs"
                />
                Enable this delivery
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={form.require_approval}
                  disabled={busy || form.delivery_type === 'approval_first'}
                  onCheckedChange={require_approval => setForm(current => ({ ...current, require_approval }))}
                  size="xs"
                />
                Require approval before sending
              </label>
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

function googleFormsWebhookScript(webhookUrl: string, secret: string): string {
  return [
    '/** Paste into Google Forms → Extensions → Apps Script, then set installable onFormSubmit trigger. */',
    'const VERXIO_WEBHOOK_URL = ' + JSON.stringify(webhookUrl) + ';',
    'const VERXIO_WEBHOOK_SECRET = ' + JSON.stringify(secret) + ';',
    '',
    'function onFormSubmit(e) {',
    '  const form = FormApp.getActiveForm();',
    '  const response = e.response;',
    '  const answers = {};',
    '  response.getItemResponses().forEach(function (item) {',
    '    answers[item.getItem().getTitle()] = item.getResponse();',
    '  });',
    '  const payload = {',
    '    source: "googleforms",',
    '    event: "googleforms.response_submitted",',
    '    form: { title: form.getTitle(), id: form.getId() },',
    '    response: {',
    '      respondentEmail: response.getRespondentEmail() || "",',
    '      submittedAt: new Date().toISOString(),',
    '      answers: answers',
    '    }',
    '  };',
    '  UrlFetchApp.fetch(VERXIO_WEBHOOK_URL, {',
    '    method: "post",',
    '    contentType: "application/json",',
    '    headers: { "X-Verxio-Webhook-Secret": VERXIO_WEBHOOK_SECRET },',
    '    payload: JSON.stringify(payload),',
    '    muteHttpExceptions: true',
    '  });',
    '}'
  ].join('\n')
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
  const [eventName, setEventName] = useState('external.event')
  const [name, setName] = useState('')
  const [webhookSource, setWebhookSource] = useState('generic')
  const [scheduleMode, setScheduleMode] = useState('interval')
  const [scheduleMinutes, setScheduleMinutes] = useState('60')
  const [cronExpression, setCronExpression] = useState('0 9 * * 1-5')
  const [connectedAccounts, setConnectedAccounts] = useState<ComposioConnectedAccount[]>([])
  const [composioApps, setComposioApps] = useState<ComposioApp[]>([])
  const [connectedAccountId, setConnectedAccountId] = useState('')
  const [appTriggerTypes, setAppTriggerTypes] = useState<ComposioTriggerType[]>([])
  const [appTriggerTypesLoading, setAppTriggerTypesLoading] = useState(false)
  const [appTriggerTypesError, setAppTriggerTypesError] = useState<string | null>(null)
  const [appTriggerSlug, setAppTriggerSlug] = useState('')
  const [appTriggerConfig, setAppTriggerConfig] = useState<Record<string, string>>({})
  const [messagingPlatforms, setMessagingPlatforms] = useState<MessagingPlatformInfo[]>([])
  const [messagingBinding, setMessagingBinding] = useState('')
  const [messageKeyword, setMessageKeyword] = useState('')
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [copiedScriptTriggerId, setCopiedScriptTriggerId] = useState<string | null>(null)
  const [copiedWebhookValue, setCopiedWebhookValue] = useState<string | null>(null)
  const visibleTriggers = triggers.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE)
  const selectedSource = TRIGGER_SOURCES.find(source => source.id === sourceId) ?? TRIGGER_SOURCES[0]
  const selectedAppTrigger = appTriggerTypes.find(trigger => trigger.slug === appTriggerSlug)

  const appTriggerProperties =
    selectedAppTrigger?.config &&
    typeof selectedAppTrigger.config.properties === 'object' &&
    selectedAppTrigger.config.properties !== null
      ? (selectedAppTrigger.config.properties as Record<string, Record<string, unknown>>)
      : {}

  const appTriggerRequired = Array.isArray(selectedAppTrigger?.config?.required)
    ? selectedAppTrigger.config.required.map(String)
    : []

  const messagingOptions = useMemo(
    () =>
      messagingPlatforms.flatMap(platform => {
        if (!platform.configured || !platform.enabled) {
          return []
        }

        const connections = (platform.connections ?? []).filter(
          connection => connection.configured && connection.enabled
        )

        if (connections.length === 0) {
          return [{ id: `${platform.id}::default`, label: platform.name, platformId: platform.id }]
        }

        return connections.map(connection => ({
          id: `${platform.id}::${connection.id}`,
          label: `${platform.name} · ${connection.label}`,
          platformId: platform.id
        }))
      }),
    [messagingPlatforms]
  )

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(triggers.length / PANEL_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, triggers.length])

  useEffect(() => {
    let active = true

    void Promise.allSettled([listComposioConnections(), listComposioApps(), getMessagingPlatforms()]).then(
      ([accountsResult, appsResult, gatewaysResult]) => {
        if (!active) {
          return
        }

        const errors: string[] = []

        if (accountsResult.status === 'fulfilled') {
          setConnectedAccounts(
            accountsResult.value.accounts.filter(account => account.status.toUpperCase() === 'ACTIVE')
          )
        } else {
          errors.push('connected apps')
        }

        if (appsResult.status === 'fulfilled') {
          setComposioApps(appsResult.value.apps)
        }

        if (gatewaysResult.status === 'fulfilled') {
          setMessagingPlatforms(gatewaysResult.value.platforms)
        } else {
          errors.push('messaging gateways')
        }

        setSourcesError(
          errors.length > 0 ? `Could not load ${errors.join(' or ')}. Retry from their setup pages.` : null
        )
        setSourcesLoading(false)
      }
    )

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const account = connectedAccounts.find(item => item.id === connectedAccountId)
    let active = true
    setAppTriggerTypes([])
    setAppTriggerSlug('')
    setAppTriggerConfig({})
    setAppTriggerTypesError(null)

    if (!account) {
      return () => {
        active = false
      }
    }

    setAppTriggerTypesLoading(true)
    void listComposioTriggerTypes(account.appSlug)
      .then(result => {
        if (active) {
          setAppTriggerTypes(result.triggers)
        }
      })
      .catch(error => {
        if (active) {
          setAppTriggerTypesError(error instanceof Error ? error.message : 'Could not load app events.')
        }
      })
      .finally(() => {
        if (active) {
          setAppTriggerTypesLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [connectedAccountId, connectedAccounts])

  const selectSource = (id: TriggerSourceId) => {
    const source = TRIGGER_SOURCES.find(item => item.id === id)

    if (!source) {
      return
    }

    setSourceId(source.id)
    setType(source.triggerType)
    setEventName(source.eventName)
    setName(source.name)
  }

  const addTrigger = async () => {
    onError(null)

    try {
      const config: Record<string, unknown> = { version: 1 }

      if (sourceId === 'webhook') {
        config.source = webhookSource
      } else if (sourceId === 'schedule') {
        if (scheduleMode === 'cron') {
          if (!cronExpression.trim()) {
            throw new Error('Enter a cron expression.')
          }

          config.cron = cronExpression.trim()
        } else {
          const everyMinutes = Number.parseInt(scheduleMinutes, 10)

          if (!Number.isFinite(everyMinutes) || everyMinutes < 1) {
            throw new Error('Schedule interval must be at least one minute.')
          }

          config.everyMinutes = everyMinutes
        }
      } else if (sourceId === 'app_event') {
        const account = connectedAccounts.find(item => item.id === connectedAccountId)
        const trigger = appTriggerTypes.find(item => item.slug === appTriggerSlug)

        if (!account) {
          throw new Error('Select a connected app account.')
        }

        if (!trigger) {
          throw new Error('Select an event from the connected app.')
        }

        config.appSlug = account.appSlug
        config.connectedAccountId = account.id
        config.triggerSlug = trigger.slug
        config.triggerConfig = Object.fromEntries(
          Object.entries(appTriggerProperties).flatMap<[string, unknown]>(([key, schema]) => {
            const rawValue = appTriggerConfig[key]?.trim() ?? ''

            if (!rawValue) {
              if (appTriggerRequired.includes(key)) {
                throw new Error(`${String(schema.title || key)} is required.`)
              }

              return []
            }

            if (schema.type === 'number' || schema.type === 'integer') {
              const value = Number(rawValue)

              if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
                throw new Error(`${String(schema.title || key)} must be a number.`)
              }

              return [[key, value]]
            }

            if (schema.type === 'boolean') {
              return [[key, rawValue === 'true']]
            }

            if (schema.type === 'array' || schema.type === 'object') {
              try {
                const value: unknown = JSON.parse(rawValue)

                if (
                  (schema.type === 'array' && !Array.isArray(value)) ||
                  (schema.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value)))
                ) {
                  throw new Error('type mismatch')
                }

                return [[key, value]]
              } catch {
                throw new Error(`${String(schema.title || key)} must be valid JSON.`)
              }
            }

            return [[key, rawValue]]
          })
        )
      } else if (sourceId === 'messaging') {
        const option = messagingOptions.find(item => item.id === messagingBinding)

        if (!option) {
          throw new Error('Select a configured messaging connection.')
        }

        const [, connectionId] = option.id.split('::')
        config.channel = option.platformId === 'whatsapp_cloud' ? 'whatsapp' : option.platformId
        config.connectionId = connectionId

        if (messageKeyword.trim()) {
          config.keyword = messageKeyword.trim()
        }
      } else if (sourceId === 'embed') {
        config.source = 'embed'
      }

      onBusy(true)
      await createWorkflowTrigger(agent.id, {
        config,
        event_name: sourceId === 'app_event' ? appTriggerSlug : eventName,
        name,
        trigger_type: type
      })
      setName('')
      await onRefresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create trigger.')
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

  const copyWebhookValue = async (key: string, label: string, value: string) => {
    try {
      await writeClipboardText(value)
      setCopiedWebhookValue(key)
      window.setTimeout(() => setCopiedWebhookValue(current => (current === key ? null : current)), 1600)
      notify({ kind: 'success', message: `${label} is ready to paste.`, title: `${label} copied` })
    } catch (err) {
      notifyError(err, `Could not copy ${label.toLowerCase()}`)
    }
  }

  const copyGoogleFormsScript = async (trigger: WorkflowTrigger) => {
    if (!trigger.webhook_url || !trigger.secret) {
      onError('Webhook URL and secret are required before copying the Google Forms script.')

      return
    }

    try {
      const webhookUrl = trigger.webhook_url
      const isLocalWebhook = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?\b/i.test(webhookUrl)

      await writeClipboardText(googleFormsWebhookScript(webhookUrl, trigger.secret))
      setCopiedScriptTriggerId(trigger.id)
      window.setTimeout(() => setCopiedScriptTriggerId(current => (current === trigger.id ? null : current)), 1600)
      notify({
        kind: isLocalWebhook ? 'warning' : 'success',
        message: isLocalWebhook
          ? 'Script copied. Replace the localhost webhook host with a public tunnel URL (ngrok/cloudflared) before deploying the Apps Script.'
          : 'Paste into Google Forms → Extensions → Apps Script, then add an onFormSubmit trigger.',
        title: 'Google Forms script copied'
      })
    } catch (err) {
      notifyError(err, 'Could not copy Google Forms script')
    }
  }

  return (
    <section className="mt-4 grid gap-4">
      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <div>
          <h3 className="text-xs font-semibold">Add trigger</h3>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Choose one source, then bind it to a real connection or endpoint.
          </p>
        </div>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium" htmlFor="trigger-source">
            What starts this agent?
          </label>
          <Select disabled={busy} onValueChange={value => selectSource(value as TriggerSourceId)} value={sourceId}>
            <SelectTrigger id="trigger-source" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_SOURCES.map(source => (
                <SelectItem key={source.id} value={source.id}>
                  {source.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{selectedSource.description}</p>
        </div>
        {sourceId === 'webhook' ? (
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="webhook-source">
              Payload source
            </label>
            <Select disabled={busy} onValueChange={setWebhookSource} value={webhookSource}>
              <SelectTrigger id="webhook-source" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generic">Generic JSON / custom backend</SelectItem>
                <SelectItem value="airtable">Airtable automation</SelectItem>
                <SelectItem value="google_forms">Google Forms</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {sourceId === 'schedule' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium" htmlFor="schedule-mode">
                Schedule type
              </label>
              <Select disabled={busy} onValueChange={setScheduleMode} value={scheduleMode}>
                <SelectTrigger id="schedule-mode" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interval">Repeat every few minutes</SelectItem>
                  <SelectItem value="cron">Cron expression</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scheduleMode === 'cron' ? (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium" htmlFor="cron-expression">
                  Cron expression <span className="font-normal text-muted-foreground">(UTC)</span>
                </label>
                <Input
                  autoComplete="off"
                  disabled={busy}
                  id="cron-expression"
                  onChange={event => setCronExpression(event.target.value)}
                  placeholder="0 9 * * 1-5"
                  spellCheck={false}
                  value={cronExpression}
                />
              </div>
            ) : (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium" htmlFor="schedule-minutes">
                  Run every (minutes)
                </label>
                <Input
                  disabled={busy}
                  id="schedule-minutes"
                  inputMode="numeric"
                  min="1"
                  onChange={event => setScheduleMinutes(event.target.value)}
                  pattern="[0-9]*"
                  type="text"
                  value={scheduleMinutes}
                />
              </div>
            )}
          </div>
        ) : null}
        {sourceId === 'app_event' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium" htmlFor="connected-app-account">
                Connected app account
              </label>
              <Select
                disabled={busy || sourcesLoading || connectedAccounts.length === 0}
                onValueChange={setConnectedAccountId}
                value={connectedAccountId}
              >
                <SelectTrigger id="connected-app-account" size="sm">
                  <SelectValue placeholder={sourcesLoading ? 'Loading connections…' : 'Select an account'} />
                </SelectTrigger>
                <SelectContent avoidCollisions={false} side="bottom">
                  {connectedAccounts.map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      {connectedAppDisplayName(account.appSlug, composioApps)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium" htmlFor="connected-app-event">
                App event
              </label>
              <Select
                disabled={busy || appTriggerTypesLoading || appTriggerTypes.length === 0}
                onValueChange={value => {
                  setAppTriggerSlug(value)
                  const trigger = appTriggerTypes.find(item => item.slug === value)

                  const properties =
                    trigger?.config &&
                    typeof trigger.config.properties === 'object' &&
                    trigger.config.properties !== null
                      ? (trigger.config.properties as Record<string, Record<string, unknown>>)
                      : {}

                  setAppTriggerConfig(
                    Object.fromEntries(
                      Object.entries(properties).flatMap(([key, schema]) =>
                        schema.default === undefined
                          ? []
                          : [
                              [
                                key,
                                typeof schema.default === 'object'
                                  ? JSON.stringify(schema.default)
                                  : String(schema.default)
                              ]
                            ]
                      )
                    )
                  )
                }}
                value={appTriggerSlug}
              >
                <SelectTrigger id="connected-app-event" size="sm">
                  <SelectValue placeholder={appTriggerTypesLoading ? 'Loading events…' : 'Select an event'} />
                </SelectTrigger>
                <SelectContent avoidCollisions={false} side="bottom">
                  {appTriggerTypes.map(trigger => (
                    <SelectItem key={trigger.slug} value={trigger.slug}>
                      {trigger.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {Object.entries(appTriggerProperties).map(([key, schema]) => (
              <div className="grid gap-1.5" key={key}>
                <label className="text-xs font-medium" htmlFor={`app-trigger-${key}`}>
                  {String(schema.title || key)}
                  {!appTriggerRequired.includes(key) ? (
                    <span className="font-normal text-muted-foreground"> (optional)</span>
                  ) : null}
                </label>
                {Array.isArray(schema.enum) && schema.enum.length > 0 ? (
                  <Select
                    disabled={busy}
                    onValueChange={value => setAppTriggerConfig(current => ({ ...current, [key]: value }))}
                    value={appTriggerConfig[key] ?? ''}
                  >
                    <SelectTrigger id={`app-trigger-${key}`} size="sm">
                      <SelectValue placeholder="Select a value" />
                    </SelectTrigger>
                    <SelectContent>
                      {schema.enum.map(option => (
                        <SelectItem key={String(option)} value={String(option)}>
                          {String(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : schema.type === 'boolean' ? (
                  <Select
                    disabled={busy}
                    onValueChange={value => setAppTriggerConfig(current => ({ ...current, [key]: value }))}
                    value={appTriggerConfig[key] ?? ''}
                  >
                    <SelectTrigger id={`app-trigger-${key}`} size="sm">
                      <SelectValue placeholder="Select a value" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    disabled={busy}
                    id={`app-trigger-${key}`}
                    onChange={event => setAppTriggerConfig(current => ({ ...current, [key]: event.target.value }))}
                    placeholder={String(schema.description || schema.default || '')}
                    type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
                    value={appTriggerConfig[key] ?? ''}
                  />
                )}
              </div>
            ))}
            {!sourcesLoading && connectedAccounts.length === 0 ? (
              <p className="text-[0.7rem] text-muted-foreground md:col-span-2">
                No active connected apps. Connect one in Settings before adding this trigger.
              </p>
            ) : null}
            {appTriggerTypesError ? (
              <p className="text-[0.7rem] text-destructive md:col-span-2">{appTriggerTypesError}</p>
            ) : null}
          </div>
        ) : null}
        {sourceId === 'messaging' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium" htmlFor="messaging-binding">
                Messaging connection
              </label>
              <Select
                disabled={busy || sourcesLoading || messagingOptions.length === 0}
                onValueChange={setMessagingBinding}
                value={messagingBinding}
              >
                <SelectTrigger id="messaging-binding" size="sm">
                  <SelectValue placeholder={sourcesLoading ? 'Loading gateways…' : 'Select a connection'} />
                </SelectTrigger>
                <SelectContent>
                  {messagingOptions.map(option => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium" htmlFor="message-keyword">
                Only messages containing <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                disabled={busy}
                id="message-keyword"
                onChange={event => setMessageKeyword(event.target.value)}
                placeholder="@verxioBot"
                value={messageKeyword}
              />
            </div>
            {!sourcesLoading && messagingOptions.length === 0 ? (
              <p className="text-[0.7rem] text-muted-foreground md:col-span-2">
                No enabled messaging connections. Configure one in Messaging before adding this trigger.
              </p>
            ) : null}
          </div>
        ) : null}
        {sourcesError && (sourceId === 'app_event' || sourceId === 'messaging') ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {sourcesError}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {sourceId !== 'manual' && sourceId !== 'embed' && sourceId !== 'app_event' ? (
            <div className="grid gap-1.5">
              <label className="text-xs font-medium" htmlFor="trigger-event">
                Event name
              </label>
              <Input
                disabled={busy}
                id="trigger-event"
                onChange={event => setEventName(event.target.value)}
                placeholder="external.event"
                value={eventName}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="trigger-name">
              Trigger name
            </label>
            <Input
              disabled={busy}
              id="trigger-name"
              onChange={event => setName(event.target.value)}
              placeholder={selectedSource.name}
              value={name}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button disabled={busy} onClick={addTrigger} size="sm">
            {busy ? (
              <Loader className="size-4 text-primary" label="Creating trigger" strokeScale={0.7} type="rose-two" />
            ) : (
              <Plus className="size-4" />
            )}
            Add trigger
          </Button>
        </div>
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
              <div className="grid gap-2 rounded-md bg-muted/35 p-2 font-mono text-[0.68rem] text-muted-foreground">
                <span className="wrap-anywhere">URL: {trigger.webhook_url}</span>
                <span className="wrap-anywhere">Secret header: X-Verxio-Webhook-Secret: {trigger.secret}</span>
                {trigger.webhook_url && trigger.secret ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void copyWebhookValue(`${trigger.id}:url`, 'Webhook URL', trigger.webhook_url as string)
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Copy className="size-3.5" />
                      {copiedWebhookValue === `${trigger.id}:url` ? 'Copied URL' : 'Copy URL'}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void copyWebhookValue(
                          `${trigger.id}:secret`,
                          'Webhook secret',
                          `X-Verxio-Webhook-Secret: ${trigger.secret}`
                        )
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Copy className="size-3.5" />
                      {copiedWebhookValue === `${trigger.id}:secret` ? 'Copied secret' : 'Copy secret'}
                    </Button>
                    {trigger.config?.source === 'google_forms' || trigger.event_name.startsWith('googleforms.') ? (
                      <>
                        <Button
                          disabled={busy}
                          onClick={() => void copyGoogleFormsScript(trigger)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Copy className="size-3.5" />
                          {copiedScriptTriggerId === trigger.id ? 'Copied Forms script' : 'Copy Google Forms script'}
                        </Button>
                        <span className="font-sans text-[0.65rem] leading-relaxed text-muted-foreground">
                          Paste into Forms → Apps Script, then add an installable onFormSubmit trigger.
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : null}
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

function runStatusVariant(status: WorkflowRun['status']): 'default' | 'destructive' | 'muted' | 'warn' {
  if (status === 'completed') {
    return 'default'
  }

  if (status === 'failed') {
    return 'destructive'
  }

  if (status === 'running' || status === 'queued') {
    return 'warn'
  }

  return 'muted'
}

function runOutputTitle(outputText: string): string | null {
  const firstLine = outputText
    .split('\n')
    .map(line => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return null
  }

  const heading = firstLine.match(/^#{1,6}\s+(.+)$/)

  return heading?.[1]?.trim() || null
}

/** Prefer a compact key/value table when the model returns bullet fields like `- **Score:** 80`. */
function formatRunOutputMarkdown(outputText: string): string {
  const lines = outputText.replace(/\r\n/g, '\n').split('\n')
  const pairs: Array<{ key: string; value: string }> = []
  const other: string[] = []

  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+\*\*(.+?)\*\*\s*[:：]\s*(.+)\s*$/)

    if (match) {
      pairs.push({ key: match[1].trim(), value: match[2].trim() })

      continue
    }

    other.push(line)
  }

  if (pairs.length < 2) {
    return outputText
  }

  const titleLine = other.map(line => line.trim()).find(line => line.length > 0) || ''

  const leftover = other
    .filter(line => line.trim() && line.trim() !== titleLine)
    .join('\n')
    .trim()

  const table = ['| Field | Detail |', '| --- | --- |', ...pairs.map(pair => `| ${pair.key} | ${pair.value} |`)].join(
    '\n'
  )

  return [titleLine, table, leftover].filter(Boolean).join('\n\n')
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
      <div className="grid gap-3">
        {runs.length === 0 ? <p className="text-xs text-muted-foreground">No runs yet.</p> : null}
        {visibleRuns.map(item => {
          const title = item.output_text ? runOutputTitle(item.output_text) : null
          const formattedOutput = item.output_text ? formatRunOutputMarkdown(item.output_text) : ''

          return (
            <article className="grid gap-3 rounded-md border border-(--stroke-nous) p-3" key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.status === 'completed' ? (
                      <CheckCircle2 className="size-4 shrink-0 text-primary" />
                    ) : item.status === 'failed' ? (
                      <AlertCircle className="size-4 shrink-0 text-destructive" />
                    ) : (
                      <Zap className="size-4 shrink-0 text-primary" />
                    )}
                    <Badge variant={runStatusVariant(item.status)}>{item.status}</Badge>
                    <Badge variant="outline">{item.trigger_type}</Badge>
                  </div>
                  {title ? <p className="text-sm font-medium text-foreground">{title}</p> : null}
                </div>
                <span className="shrink-0 text-[0.68rem] text-muted-foreground">{formatDate(item.created_at)}</span>
              </div>

              {formattedOutput ? (
                <div className="rounded-md border border-(--stroke-nous) bg-muted/20 p-3">
                  <CompactMarkdown className="text-foreground/90" text={formattedOutput} />
                </div>
              ) : null}
              {item.error ? <p className="text-xs leading-relaxed text-destructive">{item.error}</p> : null}

              <div className="grid gap-2 border-t border-(--stroke-nous) pt-2">
                <details className="text-[0.68rem] text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground/80">Input</summary>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted/35 p-2 font-mono">
                    {JSON.stringify(item.input, null, 2)}
                  </pre>
                </details>
                <details
                  className="text-[0.68rem] text-muted-foreground"
                  onToggle={event => {
                    if (event.currentTarget.open) {
                      void loadEvents(item.id)
                    }
                  }}
                >
                  <summary className="cursor-pointer font-medium text-foreground/80">Events</summary>
                  <div className="mt-2 grid gap-2 rounded-md bg-muted/35 p-2">
                    {loadingEventsRunId === item.id ? (
                      <Loader
                        className="size-4 text-primary"
                        label="Loading run events"
                        strokeScale={0.7}
                        type="rose-two"
                      />
                    ) : null}
                    {(eventsByRunId[item.id] || []).map(event => (
                      <div className="grid gap-1 border-l-2 border-primary/45 pl-2" key={event.id}>
                        <span className="font-medium text-foreground/90">
                          {event.event_type} · {formatDate(event.created_at)}
                        </span>
                        {event.message ? <span>{event.message}</span> : null}
                        {Object.keys(event.metadata || {}).length > 0 ? (
                          <pre className="overflow-x-auto rounded-md bg-background/70 p-2 font-mono">
                            {JSON.stringify(event.metadata, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                    {!loadingEventsRunId && (eventsByRunId[item.id] || []).length === 0 ? (
                      <span>No events recorded for this run.</span>
                    ) : null}
                  </div>
                </details>
              </div>
            </article>
          )
        })}
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
