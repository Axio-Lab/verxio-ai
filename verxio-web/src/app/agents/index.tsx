import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { PaginationControl } from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle, CheckCircle2, Plus, RefreshCw, Save, Send, Sparkles, Trash2, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  createKnowledgeBase,
  createKnowledgeDocument,
  createWorkflowAgent,
  createWorkflowTrigger,
  deleteKnowledgeBase,
  deleteWorkflowAgent,
  deleteWorkflowTrigger,
  type KnowledgeBase,
  listKnowledgeBases,
  listWorkflowAgents,
  listWorkflowIntegrationCapabilities,
  listWorkflowRunEvents,
  listWorkflowRuns,
  listWorkflowSkillCapabilities,
  listWorkflowTriggers,
  runWorkflowAgent,
  updateWorkflowAgent,
  updateWorkflowTrigger,
  type WorkflowAgent,
  type WorkflowIntegrationCapability,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowSkillCapability,
  type WorkflowTrigger,
  type WorkflowTriggerType
} from '@/lib/verxio-api'

import { OverlayView } from '../overlays/overlay-view'

type AgentTab = 'instructions' | 'skills' | 'knowledge' | 'integrations' | 'triggers' | 'runs'

const AGENT_TABS: Array<{ id: AgentTab; label: string }> = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'skills', label: 'Skills' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'runs', label: 'Runs' }
]

const TRIGGER_TYPES: WorkflowTriggerType[] = ['manual', 'webhook', 'schedule', 'api', 'app_event', 'chat']
const AGENT_PAGE_SIZE = 8
const PANEL_PAGE_SIZE = 6

interface AgentsViewProps {
  onClose: () => void
}

interface DraftState {
  approval_policy: string
  description: string
  enabled: boolean
  instructions: string
  integrationsText: string
  knowledgeText: string
  name: string
  role: string
  skillsText: string
}

function draftFromAgent(agent?: WorkflowAgent | null): DraftState {
  return {
    approval_policy: agent?.approval_policy ?? 'default',
    description: agent?.description ?? '',
    enabled: agent?.enabled ?? true,
    instructions: agent?.instructions ?? '',
    integrationsText: (agent?.integrations ?? []).join('\n'),
    knowledgeText: (agent?.knowledge ?? []).join('\n'),
    name: agent?.name ?? '',
    role: agent?.role ?? '',
    skillsText: (agent?.skills ?? []).join('\n')
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

export function AgentsView({ onClose }: AgentsViewProps) {
  const [agents, setAgents] = useState<WorkflowAgent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftState>(() => draftFromAgent())
  const [triggers, setTriggers] = useState<WorkflowTrigger[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [integrationCapabilities, setIntegrationCapabilities] = useState<WorkflowIntegrationCapability[]>([])
  const [integrationCapabilityErrors, setIntegrationCapabilityErrors] = useState<string[]>([])
  const [skillCapabilities, setSkillCapabilities] = useState<WorkflowSkillCapability[]>([])
  const [skillCapabilityErrors, setSkillCapabilityErrors] = useState<string[]>([])
  const [tab, setTab] = useState<AgentTab>('instructions')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => agents.find(agent => agent.id === selectedId) ?? null, [agents, selectedId])

  const refreshAgents = useCallback(async () => {
    setError(null)
    setLoading(true)

    try {
      const [result, skillsResult, knowledgeResult, integrationsResult] = await Promise.allSettled([
        listWorkflowAgents(),
        listWorkflowSkillCapabilities(),
        listKnowledgeBases(),
        listWorkflowIntegrationCapabilities()
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

      setAgents(result.value.agents)
      setSelectedId(current => current ?? result.value.agents[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load agents.')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshDetails = useCallback(async (agentId: string) => {
    try {
      const [triggerResult, runResult] = await Promise.all([listWorkflowTriggers(agentId), listWorkflowRuns(agentId)])
      setTriggers(triggerResult.triggers)
      setRuns(runResult.runs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load agent details.')
    }
  }, [])

  useEffect(() => {
    void refreshAgents()
  }, [refreshAgents])

  useEffect(() => {
    setDraft(draftFromAgent(selected))

    if (selected) {
      void refreshDetails(selected.id)
    } else {
      setTriggers([])
      setRuns([])
    }
  }, [refreshDetails, selected])

  const saveAgent = async () => {
    if (!draft.name.trim()) {
      setError('Agent name is required.')

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
      name: draft.name,
      role: draft.role,
      skills: lines(draft.skillsText)
    }

    try {
      const saved = selected ? await updateWorkflowAgent(selected.id, input) : await createWorkflowAgent(input)
      setAgents(current => {
        const exists = current.some(agent => agent.id === saved.id)

        return exists ? current.map(agent => (agent.id === saved.id ? saved : agent)) : [saved, ...current]
      })
      setSelectedId(saved.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save agent.')
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
      await deleteWorkflowAgent(selected.id)
      setAgents(current => current.filter(agent => agent.id !== selected.id))
      setSelectedId(null)
      setDraft(draftFromAgent())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete agent.')
    } finally {
      setBusy(false)
    }
  }

  const createNew = () => {
    setSelectedId(null)
    setDraft(draftFromAgent())
    setTriggers([])
    setRuns([])
    setTab('instructions')
  }

  return (
    <OverlayView
      closeLabel="Close agents"
      contentClassName="px-5 pt-[calc(var(--titlebar-height)+1rem)] pb-4 sm:px-6"
      onClose={onClose}
      rootClassName="mx-auto max-w-6xl"
    >
      <header className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3 pr-11">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Agents</h2>
          <p className="text-xs text-muted-foreground/80">
            Create reusable workers with skills, knowledge, tools, integrations, triggers, and runs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={loading || busy} onClick={() => void refreshAgents()} size="sm" variant="ghost">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button disabled={busy} onClick={createNew} size="sm">
            <Plus className="size-4" />
            New agent
          </Button>
        </div>
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
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)]">
          <AgentList agents={agents} onCreate={createNew} onSelect={setSelectedId} selectedId={selectedId} />
          <main className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <AgentEditor
              busy={busy}
              draft={draft}
              integrationCapabilities={integrationCapabilities}
              integrationCapabilityErrors={integrationCapabilityErrors}
              knowledgeBases={knowledgeBases}
              onChange={setDraft}
              onDelete={selected ? removeAgent : undefined}
              onKnowledgeBasesChange={setKnowledgeBases}
              onSave={saveAgent}
              selected={selected}
              setTab={setTab}
              skillCapabilities={skillCapabilities}
              skillCapabilityErrors={skillCapabilityErrors}
              tab={tab}
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
              </>
            ) : null}
          </main>
        </div>
      )}
    </OverlayView>
  )
}

function AgentList({
  agents,
  onCreate,
  onSelect,
  selectedId
}: {
  agents: WorkflowAgent[]
  onCreate: () => void
  onSelect: (id: string) => void
  selectedId: null | string
}) {
  const [page, setPage] = useState(1)
  const visibleAgents = agents.slice((page - 1) * AGENT_PAGE_SIZE, page * AGENT_PAGE_SIZE)

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(agents.length / AGENT_PAGE_SIZE))

    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [agents.length, page])

  if (agents.length === 0) {
    return (
      <aside className="grid place-items-center rounded-md border border-dashed border-(--stroke-nous) p-5 text-center">
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
      </aside>
    )
  }

  return (
    <aside className="flex min-h-0 flex-col rounded-md border border-(--stroke-nous) p-2">
      <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto">
        {visibleAgents.map(agent => (
          <button
            className={cn(
              'grid gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-(--chrome-action-hover)',
              selectedId === agent.id && 'bg-primary/10 text-foreground'
            )}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            type="button"
          >
            <span className="flex items-center gap-2 text-xs font-medium">
              <span className={cn('size-1.5 rounded-full', agent.enabled ? 'bg-primary' : 'bg-muted-foreground/50')} />
              {agent.name}
            </span>
            <span className="line-clamp-2 text-[0.7rem] leading-relaxed text-muted-foreground">
              {agent.role || agent.description || 'Reusable workflow agent'}
            </span>
          </button>
        ))}
      </div>
      <PaginationControl
        className="mt-2 border-t border-(--stroke-nous) pt-2"
        itemLabel="agents"
        onPageChange={setPage}
        page={page}
        pageSize={AGENT_PAGE_SIZE}
        total={agents.length}
      />
    </aside>
  )
}

function AgentEditor({
  busy,
  draft,
  integrationCapabilities,
  integrationCapabilityErrors,
  knowledgeBases,
  onChange,
  onDelete,
  onKnowledgeBasesChange,
  onSave,
  selected,
  setTab,
  skillCapabilities,
  skillCapabilityErrors,
  tab
}: {
  busy: boolean
  draft: DraftState
  integrationCapabilities: WorkflowIntegrationCapability[]
  integrationCapabilityErrors: string[]
  knowledgeBases: KnowledgeBase[]
  onChange: (draft: DraftState) => void
  onDelete?: () => void
  onKnowledgeBasesChange: (knowledgeBases: KnowledgeBase[]) => void
  onSave: () => void
  selected: WorkflowAgent | null
  setTab: (tab: AgentTab) => void
  skillCapabilities: WorkflowSkillCapability[]
  skillCapabilityErrors: string[]
  tab: AgentTab
}) {
  const patch = (updates: Partial<DraftState>) => onChange({ ...draft, ...updates })

  return (
    <section className="grid gap-4">
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            className="flex items-center gap-2 text-xs text-muted-foreground"
            onClick={() => patch({ enabled: !draft.enabled })}
            type="button"
          >
            <span className={cn('size-2 rounded-full', draft.enabled ? 'bg-primary' : 'bg-muted-foreground/50')} />
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
                <Loader className="size-4" label="Saving agent" strokeScale={0.7} type="rose-two" />
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
    </section>
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
      setError('Knowledge base name is required.')

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create knowledge base.')
    } finally {
      setLocalBusy(false)
    }
  }

  const addDocument = async () => {
    if (!documentBaseId || !documentTitle.trim() || !documentContent.trim()) {
      setError('Select a knowledge base and add a document title and content.')

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add knowledge document.')
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete knowledge base.')
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
              <Loader className="size-4" label="Creating knowledge base" strokeScale={0.7} type="rose-two" />
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
              <Loader className="size-4" label="Adding document" strokeScale={0.7} type="rose-two" />
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
  selected,
  skills
}: {
  disabled: boolean
  errors: string[]
  onChange: (items: string[]) => void
  selected: string[]
  skills: WorkflowSkillCapability[]
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const missingSelected = selected.filter(name => !skills.some(skill => skill.name === name))
  const [page, setPage] = useState(1)
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

  return (
    <div className="grid gap-3">
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
              <button
                className={cn(
                  'grid gap-1 rounded-md border border-(--stroke-nous) p-3 text-left transition-colors hover:bg-(--chrome-action-hover)',
                  checked && 'border-primary/45 bg-primary/8'
                )}
                disabled={disabled}
                key={skill.name}
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
    </div>
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

  const setTriggerType = (value: WorkflowTriggerType) => {
    setType(value)

    if (value === 'schedule') {
      setEventName('daily.digest')
      setConfigText('{"everyMinutes":60}')
    } else if (value === 'app_event') {
      setEventName('new_record')
      setConfigText('{"appSlug":"airtable"}')
    } else {
      setConfigText('{}')
    }
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
        <h3 className="text-xs font-semibold">Add trigger</h3>
        <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Select onValueChange={value => setTriggerType(value as WorkflowTriggerType)} value={type}>
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
              <Loader className="size-4" label="Creating trigger" strokeScale={0.7} type="rose-two" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </div>
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
          <p className="text-xs text-muted-foreground">No triggers yet. Start with a webhook or manual trigger.</p>
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
            <Loader className="size-4" label="Running agent" strokeScale={0.7} type="rose-two" />
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
                  <Loader className="size-4" label="Loading run events" strokeScale={0.7} type="rose-two" />
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
