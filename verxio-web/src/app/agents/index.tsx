import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle, CheckCircle2, Plus, RefreshCw, Save, Send, Sparkles, Trash2, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  createWorkflowAgent,
  createWorkflowTrigger,
  deleteWorkflowAgent,
  deleteWorkflowTrigger,
  listWorkflowAgents,
  listWorkflowRuns,
  listWorkflowTriggers,
  runWorkflowAgent,
  updateWorkflowAgent,
  updateWorkflowTrigger,
  type WorkflowAgent,
  type WorkflowRun,
  type WorkflowTrigger,
  type WorkflowTriggerType
} from '@/lib/verxio-api'

import { OverlayView } from '../overlays/overlay-view'

type AgentTab = 'instructions' | 'skills' | 'knowledge' | 'tools' | 'integrations' | 'triggers' | 'runs'

const AGENT_TABS: Array<{ id: AgentTab; label: string }> = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'skills', label: 'Skills' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'tools', label: 'Tools' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'runs', label: 'Runs' }
]

const TRIGGER_TYPES: WorkflowTriggerType[] = ['manual', 'webhook', 'schedule', 'api', 'app_event', 'chat']

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
    name: agent?.name ?? '',
    role: agent?.role ?? '',
    skillsText: (agent?.skills ?? []).join('\n'),
    toolsText: (agent?.tools ?? []).join('\n')
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
  const [tab, setTab] = useState<AgentTab>('instructions')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => agents.find(agent => agent.id === selectedId) ?? null, [agents, selectedId])

  const refreshAgents = useCallback(async () => {
    setError(null)
    setLoading(true)

    try {
      const result = await listWorkflowAgents()
      setAgents(result.agents)
      setSelectedId(current => current ?? result.agents[0]?.id ?? null)
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
      skills: lines(draft.skillsText),
      tools: lines(draft.toolsText)
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
      contentClassName="px-5 pt-5 pb-4 sm:px-6"
      onClose={onClose}
      rootClassName="mx-auto max-w-6xl"
    >
      <header className="mb-4 flex shrink-0 items-start justify-between gap-3">
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
        <div className="grid min-h-80 place-items-center">
          <Loader label="Loading agents" type="rose-curve" />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)]">
          <AgentList agents={agents} onCreate={createNew} onSelect={setSelectedId} selectedId={selectedId} />
          <main className="min-h-0 min-w-0 overflow-y-auto pr-1">
            <AgentEditor
              busy={busy}
              draft={draft}
              onChange={setDraft}
              onDelete={selected ? removeAgent : undefined}
              onSave={saveAgent}
              selected={selected}
              setTab={setTab}
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
    <aside className="min-h-0 overflow-y-auto rounded-md border border-(--stroke-nous) p-2">
      <div className="grid gap-1">
        {agents.map(agent => (
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
    </aside>
  )
}

function AgentEditor({
  busy,
  draft,
  onChange,
  onDelete,
  onSave,
  selected,
  setTab,
  tab
}: {
  busy: boolean
  draft: DraftState
  onChange: (draft: DraftState) => void
  onDelete?: () => void
  onSave: () => void
  selected: WorkflowAgent | null
  setTab: (tab: AgentTab) => void
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
        <ListEditor
          disabled={busy}
          label="Skills"
          onChange={value => patch({ skillsText: value })}
          value={draft.skillsText}
        />
      ) : null}
      {tab === 'knowledge' ? (
        <ListEditor
          disabled={busy}
          label="Knowledge bases / domain sources"
          onChange={value => patch({ knowledgeText: value })}
          value={draft.knowledgeText}
        />
      ) : null}
      {tab === 'tools' ? (
        <ListEditor
          disabled={busy}
          label="Allowed Verxio/Hermes tools"
          onChange={value => patch({ toolsText: value })}
          value={draft.toolsText}
        />
      ) : null}
      {tab === 'integrations' ? (
        <ListEditor
          disabled={busy}
          label="Allowed Composio integrations"
          onChange={value => patch({ integrationsText: value })}
          value={draft.integrationsText}
        />
      ) : null}
    </section>
  )
}

function ListEditor({
  disabled,
  label,
  onChange,
  value
}: {
  disabled: boolean
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      <Textarea
        className="min-h-44"
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        placeholder="One item per line. Use existing Verxio tools, Hermes skills, knowledge source names, or Composio app slugs."
        value={value}
      />
      <span className="text-[0.7rem] font-normal text-muted-foreground">
        These are allowlists for the agent. Runtime execution still uses existing Verxio/Hermes tools and connected
        integrations.
      </span>
    </label>
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
  const [name, setName] = useState('')

  const addTrigger = async () => {
    onBusy(true)
    onError(null)

    try {
      await createWorkflowTrigger(agent.id, { event_name: eventName, name, trigger_type: type })
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

  return (
    <section className="mt-4 grid gap-4">
      <div className="grid gap-3 rounded-md border border-(--stroke-nous) p-4">
        <h3 className="text-xs font-semibold">Add trigger</h3>
        <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Select onValueChange={value => setType(value as WorkflowTriggerType)} value={type}>
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
      </div>

      <div className="grid gap-2">
        {triggers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No triggers yet. Start with a webhook or manual trigger.</p>
        ) : null}
        {triggers.map(trigger => (
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
          </div>
        ))}
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
        {runs.map(run => (
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
          </div>
        ))}
      </div>
    </section>
  )
}
