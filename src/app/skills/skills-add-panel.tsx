import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TextTab } from '@/components/ui/text-tab'
import { Textarea } from '@/components/ui/textarea'
import {
  createCustomSkill,
  getActionStatus,
  getSkillHubSources,
  getSkillsConfig,
  installSkillFromHub,
  previewSkillFromHub,
  reloadSkills,
  searchSkillsHub,
  updateSkillsFromHub
} from '@/hermes'
import { CheckCircle2, Download, FolderOpen, Loader2, Package, RefreshCw, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import type { SkillHubPreview, SkillHubResult } from '@/types/hermes'

import { PAGE_INSET_X } from '../layout-constants'

const ADD_SECTIONS = ['hub', 'custom', 'more'] as const
type AddSection = (typeof ADD_SECTIONS)[number]

function trustLabel(level: string): string {
  switch (level) {
    case 'trusted':
      return 'Trusted'

    case 'builtin':
      return 'Built-in'

    case 'community':
      return 'Community'

    default:
      return level || 'Unknown'
  }
}

function buildSkillMarkdown(name: string, description: string, body: string): string {
  const safeName = name.trim().toLowerCase().replace(/\s+/g, '-')
  const desc = description.trim() || `Custom skill: ${safeName}`

  return `---\nname: ${safeName}\ndescription: ${desc}\n---\n\n${body.trim()}\n`
}

async function pollActionUntilDone(actionName: string): Promise<boolean> {
  const deadline = Date.now() + 120_000

  while (Date.now() < deadline) {
    const status = await getActionStatus(actionName, 80)

    if (!status.running) {
      return status.exit_code === 0
    }

    await new Promise(resolve => setTimeout(resolve, 1200))
  }

  return false
}

interface SkillsAddPanelProps {
  onSkillsChanged?: () => void
}

export function SkillsAddPanel({ onSkillsChanged }: SkillsAddPanelProps) {
  const [section, setSection] = useState<AddSection>('hub')

  const [hubQuery, setHubQuery] = useState('')
  const [hubSource, setHubSource] = useState('all')
  const [hubLoading, setHubLoading] = useState(false)
  const [hubResults, setHubResults] = useState<SkillHubResult[]>([])
  const [hubInstalled, setHubInstalled] = useState<Record<string, { name: string | null }>>({})
  const [hubSources, setHubSources] = useState<Array<{ id: string; label: string }>>([])
  const [featured, setFeatured] = useState<SkillHubResult[]>([])
  const [quickIdentifier, setQuickIdentifier] = useState('')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [detailSkill, setDetailSkill] = useState<SkillHubResult | null>(null)

  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [advancedMode, setAdvancedMode] = useState(false)
  const [customMarkdown, setCustomMarkdown] = useState('')
  const [creating, setCreating] = useState(false)

  const [externalDirs, setExternalDirs] = useState<string[]>([])
  const [reloading, setReloading] = useState(false)
  const [updatingHub, setUpdatingHub] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadHubMeta = useCallback(async () => {
    try {
      const [sourcesRes, configRes] = await Promise.all([getSkillHubSources(), getSkillsConfig()])
      setHubSources(sourcesRes.sources.map(s => ({ id: s.id, label: s.label })))
      setFeatured(sourcesRes.featured || [])
      setHubInstalled(sourcesRes.installed || {})
      setExternalDirs(configRes.external_dirs || [])
    } catch (err) {
      notifyError(err, 'Failed to load skill hub metadata')
    }
  }, [])

  const runHubSearch = useCallback(async (q: string, source: string) => {
    const trimmed = q.trim()

    if (!trimmed) {
      setHubResults([])

      return
    }

    setHubLoading(true)

    try {
      const res = await searchSkillsHub(trimmed, source, 24)
      setHubResults(res.results)
      setHubInstalled(current => ({ ...current, ...res.installed }))
    } catch (err) {
      notifyError(err, 'Skill hub search failed')
    } finally {
      setHubLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHubMeta()
  }, [loadHubMeta])

  useEffect(() => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
    }

    searchTimer.current = setTimeout(() => {
      void runHubSearch(hubQuery, hubSource)
    }, 350)

    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current)
      }
    }
  }, [hubQuery, hubSource, runHubSearch])

  const displayResults = useMemo(() => {
    if (hubQuery.trim()) {
      return hubResults
    }

    return featured
  }, [featured, hubQuery, hubResults])

  const handleInstall = useCallback(
    async (identifier: string) => {
      setInstallingId(identifier)

      try {
        const action = await installSkillFromHub(identifier)
        notify({ kind: 'info', title: 'Installing skill', message: identifier })

        const ok = await pollActionUntilDone(action.name)

        if (ok) {
          notify({ kind: 'success', title: 'Skill installed', message: identifier })
          await loadHubMeta()
          onSkillsChanged?.()
        } else {
          notify({ kind: 'error', title: 'Install failed', message: `Check logs for ${identifier}` })
        }
      } catch (err) {
        notifyError(err, 'Failed to install skill')
      } finally {
        setInstallingId(null)
      }
    },
    [loadHubMeta, onSkillsChanged]
  )

  async function handleQuickInstall() {
    const id = quickIdentifier.trim()

    if (!id) {
      return
    }

    await handleInstall(id)
    setQuickIdentifier('')
  }

  async function handleCreateCustom() {
    const name = customName.trim()

    if (!name) {
      notify({ kind: 'error', title: 'Name required', message: 'Enter a skill name.' })

      return
    }

    const content = advancedMode
      ? customMarkdown.trim()
      : buildSkillMarkdown(
          name,
          customDescription,
          customBody || `# ${name}\n\nDescribe when and how to use this skill.`
        )

    if (!content) {
      notify({ kind: 'error', title: 'Content required', message: 'Add skill instructions or SKILL.md content.' })

      return
    }

    setCreating(true)

    try {
      const result = await createCustomSkill(name, content, customCategory.trim() || undefined)
      notify({ kind: 'success', title: 'Skill created', message: result.message || name })
      setCustomName('')
      setCustomDescription('')
      setCustomCategory('')
      setCustomBody('')
      setCustomMarkdown('')
      onSkillsChanged?.()
    } catch (err) {
      notifyError(err, 'Failed to create custom skill')
    } finally {
      setCreating(false)
    }
  }

  async function handleReload() {
    setReloading(true)

    try {
      const result = await reloadSkills()
      const added = result.added?.length || 0
      const removed = result.removed?.length || 0
      notify({
        kind: 'success',
        title: 'Skills reloaded',
        message: `${added} added, ${removed} removed (${result.total ?? 0} total)`
      })
      onSkillsChanged?.()
    } catch (err) {
      notifyError(err, 'Failed to reload skills')
    } finally {
      setReloading(false)
    }
  }

  async function handleUpdateHub() {
    setUpdatingHub(true)

    try {
      const action = await updateSkillsFromHub()
      const ok = await pollActionUntilDone(action.name)

      if (ok) {
        notify({ kind: 'success', title: 'Hub skills updated', message: 'Installed hub skills were refreshed.' })
        await loadHubMeta()
        onSkillsChanged?.()
      } else {
        notify({ kind: 'error', title: 'Update failed', message: 'Check action logs for details.' })
      }
    } catch (err) {
      notifyError(err, 'Failed to update hub skills')
    } finally {
      setUpdatingHub(false)
    }
  }

  return (
    <div className={cn('h-full overflow-y-auto py-3', PAGE_INSET_X)}>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-3">
        <TextTab active={section === 'hub'} onClick={() => setSection('hub')}>
          Skills Hub
        </TextTab>
        <TextTab active={section === 'custom'} onClick={() => setSection('custom')}>
          Custom SKILL.md
        </TextTab>
        <TextTab active={section === 'more'} onClick={() => setSection('more')}>
          External & agent
        </TextTab>
      </div>

      {section === 'hub' ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Search the skills hub or install by identifier (e.g. <span className="font-mono">owner/repo/skill</span>).
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              onChange={e => setQuickIdentifier(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleQuickInstall()}
              placeholder="Install by identifier..."
              value={quickIdentifier}
            />
            <Button
              disabled={!quickIdentifier.trim() || installingId !== null}
              onClick={() => void handleQuickInstall()}
            >
              {installingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Install
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="flex-1"
              onChange={e => setHubQuery(e.target.value)}
              placeholder="Search skills hub..."
              value={hubQuery}
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              onChange={e => setHubSource(e.target.value)}
              value={hubSource}
            >
              <option value="all">All sources</option>
              {hubSources.map(source => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </div>

          {hubLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </div>
          ) : displayResults.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {hubQuery.trim() ? 'No skills match your search.' : 'No featured skills available.'}
            </div>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {displayResults.map(result => {
                const installed = Boolean(hubInstalled[result.identifier])
                const busy = installingId === result.identifier

                return (
                  <div className="flex items-start gap-3 p-3" key={result.identifier}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => setDetailSkill(result)} type="button">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{result.name}</span>
                        <Badge variant="muted">{trustLabel(result.trust_level)}</Badge>
                        <Badge variant="outline">{result.source}</Badge>
                        {installed && (
                          <Badge className="bg-emerald-500/10 text-emerald-600" variant="default">
                            installed
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.description}</p>
                      <p className="mt-1 truncate font-mono text-[0.65rem] text-muted-foreground">
                        {result.identifier}
                      </p>
                    </button>
                    <Button
                      disabled={installed || busy}
                      onClick={() => void handleInstall(result.identifier)}
                      size="sm"
                      variant={installed ? 'ghost' : 'default'}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : installed ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {installed ? 'Installed' : 'Install'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {section === 'custom' ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Create a user skill with a <span className="font-mono">SKILL.md</span> file in your profile skills
            directory. Use simple mode for a guided form, or advanced mode to paste full markdown with YAML frontmatter.
          </p>

          <div className="flex gap-2">
            <Button onClick={() => setAdvancedMode(false)} size="sm" variant={advancedMode ? 'outline' : 'default'}>
              Simple
            </Button>
            <Button onClick={() => setAdvancedMode(true)} size="sm" variant={advancedMode ? 'default' : 'outline'}>
              Advanced (full SKILL.md)
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Name</span>
              <Input onChange={e => setCustomName(e.target.value)} placeholder="my-custom-skill" value={customName} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Category (optional)</span>
              <Input onChange={e => setCustomCategory(e.target.value)} placeholder="general" value={customCategory} />
            </label>
          </div>

          {advancedMode ? (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">SKILL.md content</span>
              <Textarea
                className="min-h-64 font-mono text-xs"
                onChange={e => setCustomMarkdown(e.target.value)}
                placeholder={`---\nname: my-skill\ndescription: When to use this skill\n---\n\n# Instructions\n...`}
                value={customMarkdown}
              />
            </label>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Description</span>
                <Input
                  onChange={e => setCustomDescription(e.target.value)}
                  placeholder="When should the agent use this skill?"
                  value={customDescription}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Instructions</span>
                <Textarea
                  className="min-h-40"
                  onChange={e => setCustomBody(e.target.value)}
                  placeholder="Step-by-step guidance, examples, and constraints..."
                  value={customBody}
                />
              </label>
            </>
          )}

          <Button disabled={creating} onClick={() => void handleCreateCustom()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Create skill
          </Button>
        </div>
      ) : null}

      {section === 'more' ? (
        <div className="space-y-4">
          <InfoCard
            description="Skills can be loaded from additional directories configured in Hermes (skills.external_dirs). Add paths in your profile config to pick up SKILL.md folders outside the default skills directory."
            icon={<FolderOpen className="h-4 w-4" />}
            title="External skill directories"
          >
            {externalDirs.length > 0 ? (
              <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                {externalDirs.map(dir => (
                  <li key={dir}>{dir}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No external directories configured.</p>
            )}
            <Button
              className="mt-3"
              disabled={reloading}
              onClick={() => void handleReload()}
              size="sm"
              variant="outline"
            >
              {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Reload skills from disk
            </Button>
          </InfoCard>

          <InfoCard
            description="In chat, the agent can create and edit skills using the skill_manage tool — add reference files, patch SKILL.md, or scaffold new skills without leaving the conversation."
            icon={<Sparkles className="h-4 w-4" />}
            title="Agent-managed skills"
          />

          <InfoCard
            description="Pull the latest versions of skills you installed from the hub."
            icon={<Package className="h-4 w-4" />}
            title="Update installed hub skills"
          >
            <Button
              className="mt-3"
              disabled={updatingHub}
              onClick={() => void handleUpdateHub()}
              size="sm"
              variant="outline"
            >
              {updatingHub ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Update hub skills
            </Button>
          </InfoCard>
        </div>
      ) : null}

      {detailSkill ? (
        <SkillDetailDialog
          installed={Boolean(hubInstalled[detailSkill.identifier])}
          onClose={() => setDetailSkill(null)}
          onInstall={() => void handleInstall(detailSkill.identifier)}
          result={detailSkill}
        />
      ) : null}
    </div>
  )
}

function InfoCard({
  children,
  description,
  icon,
  title
}: {
  children?: React.ReactNode
  description: string
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}

function SkillDetailDialog({
  installed,
  onClose,
  onInstall,
  result
}: {
  installed: boolean
  onClose: () => void
  onInstall: () => void
  result: SkillHubResult
}) {
  const [preview, setPreview] = useState<SkillHubPreview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    previewSkillFromHub(result.identifier)
      .then(p => {
        if (!cancelled) {
          setPreview(p)
        }
      })
      .catch(err => notifyError(err, 'Preview failed'))
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [result.identifier])

  return (
    <Dialog onOpenChange={open => !open && onClose()} open>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{result.name}</DialogTitle>
          <DialogDescription>{result.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Badge variant="muted">{trustLabel(result.trust_level)}</Badge>
          <Badge variant="outline">{result.source}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{result.identifier}</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading preview...
          </div>
        ) : preview ? (
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {preview.skill_md}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Preview unavailable.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="outline">
            Close
          </Button>
          <Button disabled={installed} onClick={onInstall}>
            {installed ? 'Installed' : 'Install'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
