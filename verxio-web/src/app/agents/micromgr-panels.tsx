import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2 } from '@/lib/icons'
import {
  addMicromgrWorker,
  createMicromgrTask,
  deleteMicromgrTask,
  deleteMicromgrWorker,
  listMicromgrFlags,
  listMicromgrLiveboard,
  listMicromgrReports,
  listMicromgrTasks,
  listMicromgrWorkers,
  type MicromgrFlag,
  type MicromgrPlatform,
  type MicromgrReport,
  type MicromgrSubmission,
  type MicromgrTask,
  type MicromgrWorker,
  type MicromgrWorkerRole,
  triggerMicromgrReport,
  updateMicromgrFlag,
  updateMicromgrTask
} from '@/lib/verxio-api'

const PLATFORMS: Array<{ id: MicromgrPlatform; label: string }> = [
  { id: 'telegram', label: 'Telegram' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'slack', label: 'Slack' },
  { id: 'discord', label: 'Discord' },
  { id: 'email', label: 'Email' }
]

function csv(values: string[]): string {
  return values.join(', ')
}

function fromCsv(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseDestinations(value: string): Array<{ connection_id: string; destination: string; platform: string }> {
  return value
    .split(/[\n,]+/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      const [platform, destination, connectionId] = line.split(':').map(part => part.trim())

      return platform && destination ? [{ platform, destination, connection_id: connectionId || '' }] : []
    })
}

export function MicromgrTasksPanel({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<MicromgrTask[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scheduledTimes, setScheduledTimes] = useState('09:00')
  const [timezone, setTimezone] = useState('UTC')
  const [passingScore, setPassingScore] = useState('70')
  const [graceMinutes, setGraceMinutes] = useState('15')
  const [rules, setRules] = useState('')
  const [requiredItems, setRequiredItems] = useState('')
  const [reportTime, setReportTime] = useState('18:00')
  const [destinations, setDestinations] = useState('')

  const refresh = useCallback(async () => {
    try {
      const result = await listMicromgrTasks(agentId)
      setTasks(result.tasks)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load tasks.')
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onCreate = async () => {
    if (!name.trim()) {
      return
    }

    setBusy(true)

    try {
      await createMicromgrTask(agentId, {
        name: name.trim(),
        description: description.trim(),
        scheduled_times: fromCsv(scheduledTimes),
        timezone: timezone.trim() || 'UTC',
        passing_score: Number(passingScore) || 70,
        grace_minutes: Number(graceMinutes) || 15,
        acceptance_rules: fromCsv(rules),
        required_items: fromCsv(requiredItems).map(label => ({ label, evidence_type: 'PHOTO' })),
        report_time: reportTime.trim() || '18:00',
        evidence_type: 'PHOTO',
        delivery_config: {
          destinations: parseDestinations(destinations)
        }
      })
      setName('')
      setDescription('')
      setRequiredItems('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-xs font-semibold text-foreground">Tasks</h3>
        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
          Define what workers must submit, when they are due, and the passing score.
        </p>
      </div>
      {error ? <p className="text-[0.7rem] text-destructive">{error}</p> : null}
      <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3">
        <Input
          disabled={busy}
          onChange={event => setName(event.target.value)}
          placeholder="Morning kitchen inspection"
          value={name}
        />
        <Textarea
          disabled={busy}
          onChange={event => setDescription(event.target.value)}
          placeholder="Photo of a clean kitchen, counters wiped, floor dry."
          value={description}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            disabled={busy}
            onChange={event => setScheduledTimes(event.target.value)}
            placeholder="09:00, 17:00"
            value={scheduledTimes}
          />
          <Input
            disabled={busy}
            onChange={event => setTimezone(event.target.value)}
            placeholder="Africa/Lagos"
            value={timezone}
          />
          <Input
            disabled={busy}
            onChange={event => setPassingScore(event.target.value)}
            placeholder="Passing score"
            value={passingScore}
          />
          <Input
            disabled={busy}
            onChange={event => setGraceMinutes(event.target.value)}
            placeholder="Grace minutes"
            value={graceMinutes}
          />
          <Input
            disabled={busy}
            onChange={event => setReportTime(event.target.value)}
            placeholder="18:00"
            value={reportTime}
          />
        </div>
        <Input
          disabled={busy}
          onChange={event => setRules(event.target.value)}
          placeholder="Acceptance rules, comma separated"
          value={rules}
        />
        <Input
          disabled={busy}
          onChange={event => setRequiredItems(event.target.value)}
          placeholder="Required items, comma separated (optional)"
          value={requiredItems}
        />
        <Input
          disabled={busy}
          onChange={event => setDestinations(event.target.value)}
          placeholder="Report destinations: telegram:CHAT_ID:connection_id"
          value={destinations}
        />
        <Button disabled={busy || !name.trim()} onClick={() => void onCreate()} size="sm" type="button">
          <Plus className="size-4" />
          Create task
        </Button>
      </div>
      {tasks.length === 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">No tasks yet.</p>
      ) : (
        <div className="grid gap-2">
          {tasks.map(task => (
            <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3" key={task.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{task.name}</p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    {task.status} · {csv(task.scheduled_times) || 'no times'} · {task.timezone} · pass{' '}
                    {task.passing_score}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void updateMicromgrTask(agentId, task.id, {
                        status: task.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
                      }).then(refresh)
                    }
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {task.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => void deleteMicromgrTask(agentId, task.id).then(refresh)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    <Trash2 className="size-3" />
                    Delete
                  </Button>
                </div>
              </div>
              {task.description ? <p className="text-[0.7rem] text-muted-foreground">{task.description}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MicromgrWorkersPanel({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<MicromgrTask[]>([])
  const [workers, setWorkers] = useState<MicromgrWorker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<MicromgrPlatform>('telegram')
  const [externalId, setExternalId] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [role, setRole] = useState<MicromgrWorkerRole>('worker')

  const refresh = useCallback(async () => {
    try {
      const [taskResult, workerResult] = await Promise.all([listMicromgrTasks(agentId), listMicromgrWorkers(agentId)])
      setTasks(taskResult.tasks)
      setWorkers(workerResult.workers)
      setTaskId(current => current || taskResult.tasks[0]?.id || '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workers.')
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onAdd = async () => {
    if (!taskId || !name.trim() || !externalId.trim()) {
      return
    }

    setBusy(true)

    try {
      await addMicromgrWorker(agentId, {
        task_id: taskId,
        name: name.trim(),
        platform,
        external_id: externalId.trim(),
        connection_id: connectionId.trim(),
        role
      })
      setName('')
      setExternalId('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add worker.')
    } finally {
      setBusy(false)
    }
  }

  const taskName = useMemo(() => Object.fromEntries(tasks.map(task => [task.id, task.name])), [tasks])

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-xs font-semibold text-foreground">Workers</h3>
        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
          Add people by Telegram chat id, WhatsApp number, Slack user id, Discord user id, or email.
        </p>
      </div>
      {error ? <p className="text-[0.7rem] text-destructive">{error}</p> : null}
      <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3">
        <Select disabled={busy || tasks.length === 0} onValueChange={setTaskId} value={taskId || undefined}>
          <SelectTrigger>
            <SelectValue placeholder="Select a task" />
          </SelectTrigger>
          <SelectContent>
            {tasks.map(task => (
              <SelectItem key={task.id} value={task.id}>
                {task.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input disabled={busy} onChange={event => setName(event.target.value)} placeholder="Worker name" value={name} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Select disabled={busy} onValueChange={value => setPlatform(value as MicromgrPlatform)} value={platform}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select disabled={busy} onValueChange={value => setRole(value as MicromgrWorkerRole)} value={role}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="worker">Worker</SelectItem>
              <SelectItem value="supervisor">Supervisor</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          disabled={busy}
          onChange={event => setExternalId(event.target.value)}
          placeholder="Chat id, phone, user id, or email"
          value={externalId}
        />
        <Input
          disabled={busy}
          onChange={event => setConnectionId(event.target.value)}
          placeholder="Messaging connection id (optional)"
          value={connectionId}
        />
        <Button
          disabled={busy || !taskId || !name.trim() || !externalId.trim()}
          onClick={() => void onAdd()}
          size="sm"
          type="button"
        >
          <Plus className="size-4" />
          Add member
        </Button>
      </div>
      {workers.length === 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">No members yet.</p>
      ) : (
        <div className="grid gap-2">
          {workers.map(worker => (
            <div
              className="flex items-start justify-between gap-2 rounded-md border border-(--stroke-nous) p-3"
              key={worker.id}
            >
              <div>
                <p className="text-sm font-medium">{worker.name}</p>
                <p className="text-[0.7rem] text-muted-foreground">
                  {taskName[worker.task_id] || worker.task_id} · {worker.role} · {worker.platform} ·{' '}
                  {worker.external_id} · {worker.status}
                </p>
              </div>
              <Button
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => void deleteMicromgrWorker(agentId, worker.id).then(refresh)}
                size="xs"
                type="button"
                variant="outline"
              >
                <Trash2 className="size-3" />
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MicromgrLiveboardPanel({ agentId }: { agentId: string }) {
  const [submissions, setSubmissions] = useState<MicromgrSubmission[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await listMicromgrLiveboard(agentId)
      setSubmissions(result.submissions)
      setCounts(result.counts)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load liveboard.')
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-xs font-semibold text-foreground">Liveboard</h3>
        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
          Due, submitted, scored, and missed rounds.
        </p>
      </div>
      {error ? <p className="text-[0.7rem] text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2 text-[0.7rem] text-muted-foreground">
        {Object.entries(counts).map(([status, count]) => (
          <span className="rounded-md border border-(--stroke-nous) px-2 py-1" key={status}>
            {status}: {count}
          </span>
        ))}
      </div>
      {submissions.length === 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">
          No submissions yet. Reminders create them at the scheduled times.
        </p>
      ) : (
        <div className="grid gap-2">
          {submissions.map(item => (
            <div className="rounded-md border border-(--stroke-nous) p-3" key={item.id}>
              <p className="text-sm font-medium">
                {item.worker_name || item.worker_id} · {item.task_name || item.task_id}
              </p>
              <p className="text-[0.7rem] text-muted-foreground">
                {item.status}
                {item.ai_score != null ? ` · ${item.ai_score}/100` : ''} · due {item.due_at}
              </p>
              {item.ai_feedback ? <p className="mt-1 whitespace-pre-wrap text-[0.7rem]">{item.ai_feedback}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MicromgrFlagsPanel({ agentId }: { agentId: string }) {
  const [flags, setFlags] = useState<MicromgrFlag[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await listMicromgrFlags(agentId)
      setFlags(result.flags)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load flags.')
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-xs font-semibold text-foreground">Flags</h3>
        <p className="text-[0.7rem] leading-relaxed text-muted-foreground">Missed deadlines and failing scores.</p>
      </div>
      {error ? <p className="text-[0.7rem] text-destructive">{error}</p> : null}
      {flags.length === 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">No flags.</p>
      ) : (
        <div className="grid gap-2">
          {flags.map(flag => (
            <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3" key={flag.id}>
              <p className="text-sm font-medium">
                {flag.reason_label} · {flag.status} · {flag.severity}
              </p>
              <p className="text-[0.7rem] text-muted-foreground">{flag.details}</p>
              {flag.status === 'open' ? (
                <div className="flex gap-1">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      void updateMicromgrFlag(agentId, flag.id, { status: 'resolved' })
                        .then(refresh)
                        .finally(() => setBusy(false))
                    }}
                    size="xs"
                    type="button"
                  >
                    Resolve
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      void updateMicromgrFlag(agentId, flag.id, { status: 'dismissed' })
                        .then(refresh)
                        .finally(() => setBusy(false))
                    }}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    Dismiss
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MicromgrReportsPanel({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<MicromgrTask[]>([])
  const [reports, setReports] = useState<MicromgrReport[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [taskId, setTaskId] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [taskResult, reportResult] = await Promise.all([listMicromgrTasks(agentId), listMicromgrReports(agentId)])
      setTasks(taskResult.tasks)
      setReports(reportResult.reports)
      setTaskId(current => current || taskResult.tasks[0]?.id || '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports.')
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Reports</h3>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Generated on the task report cadence, or now. Delivery uses each task&apos;s destinations.
          </p>
        </div>
        <Button
          disabled={busy || !taskId}
          onClick={() => {
            setBusy(true)
            void triggerMicromgrReport(agentId, taskId)
              .then(refresh)
              .catch(err => setError(err instanceof Error ? err.message : 'Could not generate report.'))
              .finally(() => setBusy(false))
          }}
          size="sm"
          type="button"
        >
          Generate now
        </Button>
      </div>
      {error ? <p className="text-[0.7rem] text-destructive">{error}</p> : null}
      {tasks.length > 0 ? (
        <Select disabled={busy} onValueChange={setTaskId} value={taskId || undefined}>
          <SelectTrigger>
            <SelectValue placeholder="Select a task" />
          </SelectTrigger>
          <SelectContent>
            {tasks.map(task => (
              <SelectItem key={task.id} value={task.id}>
                {task.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {reports.length === 0 ? (
        <p className="text-[0.7rem] text-muted-foreground">No reports yet.</p>
      ) : (
        <div className="grid gap-2">
          {reports.map(report => (
            <div className="grid gap-2 rounded-md border border-(--stroke-nous) p-3" key={report.id}>
              <p className="text-sm font-medium">
                {report.cycle_key || report.created_at} · due {report.total_submissions} · missed {report.missed_count}
                {report.avg_score != null ? ` · avg ${report.avg_score}` : ''}
              </p>
              <pre className="whitespace-pre-wrap text-[0.7rem] leading-5">{report.summary_markdown}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
