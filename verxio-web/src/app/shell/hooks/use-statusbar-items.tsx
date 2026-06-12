import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { useI18n } from '@/i18n'
import { AlertCircle, ChevronDown, Clock, Hash, Loader2, MonitorPlay, Plug, PlugOff, Sparkles } from '@/lib/icons'
import { formatModelStatusLabel } from '@/lib/model-status-label'
import { contextBarLabel, LiveDuration, usageContextLabel } from '@/lib/statusbar'
import { cn } from '@/lib/utils'
import { $desktopActionTasks } from '@/store/activity'
import { $previewServerRestartStatus } from '@/store/preview'
import {
  $busy,
  $currentFastMode,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  $currentUsage,
  $gatewayState,
  $sessionStartedAt,
  $turnStartedAt,
  $workingSessionIds,
  setModelPickerOpen
} from '@/store/session'
import { $subagentsBySession, activeSubagentCount } from '@/store/subagents'
import { $desktopVersion, $updateApply, $updateStatus, setUpdateOverlayOpen } from '@/store/updates'

import { CRON_ROUTE } from '../../routes'
import type { StatusbarItem } from '../statusbar-controls'

interface StatusbarItemsOptions {
  agentsOpen: boolean
  commandCenterOpen: boolean
  extraLeftItems: readonly StatusbarItem[]
  extraRightItems: readonly StatusbarItem[]
  modelMenuContent?: ReactNode
  openAgents: () => void
  toggleCommandCenter: () => void
}

export function useStatusbarItems({
  agentsOpen,
  commandCenterOpen,
  extraLeftItems,
  extraRightItems,
  modelMenuContent,
  openAgents,
  toggleCommandCenter
}: StatusbarItemsOptions) {
  const { t } = useI18n()
  const copy = t.shell.statusbar
  const busy = useStore($busy)
  const gatewayState = useStore($gatewayState)
  const currentFastMode = useStore($currentFastMode)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  const currentReasoningEffort = useStore($currentReasoningEffort)
  const currentUsage = useStore($currentUsage)
  const desktopActionTasks = useStore($desktopActionTasks)
  const previewServerRestartStatus = useStore($previewServerRestartStatus)
  const sessionStartedAt = useStore($sessionStartedAt)
  const turnStartedAt = useStore($turnStartedAt)
  const workingSessionIds = useStore($workingSessionIds)
  const subagentsBySession = useStore($subagentsBySession)
  const updateStatus = useStore($updateStatus)
  const updateApply = useStore($updateApply)
  const desktopVersion = useStore($desktopVersion)

  const contextUsage = useMemo(() => usageContextLabel(currentUsage), [currentUsage])
  const contextBar = useMemo(() => contextBarLabel(currentUsage), [currentUsage])

  const { bgFailed, bgRunning, subagentsRunning } = useMemo(() => {
    const actions = Object.values(desktopActionTasks)
    const running = actions.filter(t => t.status.running).length
    const failed = actions.filter(t => !t.status.running && (t.status.exit_code ?? 0) !== 0).length
    const previewRunning = previewServerRestartStatus === 'running' ? 1 : 0
    const previewFailed = previewServerRestartStatus === 'error' ? 1 : 0

    const subagentsRunning = Object.values(subagentsBySession).reduce(
      (sum, items) => sum + activeSubagentCount(items),
      0
    )

    return {
      bgFailed: failed + previewFailed,
      bgRunning: workingSessionIds.length + running + previewRunning,
      subagentsRunning
    }
  }, [desktopActionTasks, previewServerRestartStatus, subagentsBySession, workingSessionIds])

  const serverConnected = gatewayState === 'open'
  const serverConnecting = gatewayState === 'connecting'

  const hideVersionBadge = desktopVersion?.platform === 'web'

  const versionItem = useMemo<StatusbarItem>(() => {
    const appVersion = hideVersionBadge ? null : desktopVersion?.appVersion
    const sha = updateStatus?.currentSha?.slice(0, 7) ?? null
    const behind = updateStatus?.behind ?? 0
    const applying = updateApply.applying || updateApply.stage === 'restart'
    const base = appVersion ? `v${appVersion}` : (sha ?? copy.unknown)
    const behindHint = !applying && behind > 0 ? ` (+${behind})` : ''

    const label = applying
      ? updateApply.stage === 'restart'
        ? `${base} · ${copy.restart}`
        : `${base} · ${copy.update}`
      : `${base}${behindHint}`

    const tooltip = [
      applying ? updateApply.message || copy.updateInProgress : null,
      !applying && behind > 0 && copy.commitsBehind(behind, updateStatus?.branch ?? '...'),
      appVersion && copy.desktopVersion(appVersion),
      sha && copy.commit(sha),
      updateStatus?.branch && copy.branch(updateStatus.branch)
    ]
      .filter(Boolean)
      .join(' · ')

    return {
      className: !applying && behind > 0 ? 'text-primary hover:text-primary' : undefined,
      detail: appVersion && sha && !applying ? sha : undefined,
      hidden: hideVersionBadge || (!appVersion && !sha),
      icon: applying ? <Loader2 className="size-3 animate-spin" /> : <Hash className="size-3" />,
      id: 'version',
      label,
      onSelect: () => setUpdateOverlayOpen(true),
      title: tooltip || undefined,
      variant: 'action'
    }
  }, [
    desktopVersion?.appVersion,
    hideVersionBadge,
    copy,
    updateApply.applying,
    updateApply.message,
    updateApply.stage,
    updateStatus?.behind,
    updateStatus?.branch,
    updateStatus?.currentSha
  ])

  const coreLeftStatusbarItems = useMemo<readonly StatusbarItem[]>(
    () => [
      {
        className: `w-7 justify-center px-0${commandCenterOpen ? ' bg-accent/55 text-foreground' : ''}`,
        icon: <MonitorPlay className="size-3.5" />,
        id: 'command-center',
        onSelect: toggleCommandCenter,
        title: commandCenterOpen ? copy.closeCommandCenter : copy.openCommandCenter,
        variant: 'action'
      },
      {
        className: serverConnected
          ? 'text-emerald-500'
          : serverConnecting
            ? 'text-amber-500'
            : 'text-muted-foreground/45',
        icon: serverConnected ? <Plug className="size-3.5" /> : <PlugOff className="size-3.5" />,
        id: 'connection-status',
        label: copy.status,
        title: serverConnected
          ? copy.statusConnected
          : serverConnecting
            ? copy.statusConnecting
            : copy.statusDisconnected,
        variant: 'text'
      },
      {
        className: cn(
          agentsOpen && 'bg-accent/55 text-foreground',
          bgFailed > 0 && 'text-destructive hover:text-destructive'
        ),
        detail:
          subagentsRunning > 0
            ? copy.subagents(subagentsRunning)
            : bgFailed > 0
              ? copy.failed(bgFailed)
              : bgRunning > 0
                ? copy.running(bgRunning)
                : undefined,
        icon:
          bgFailed > 0 ? (
            <AlertCircle className="size-3" />
          ) : bgRunning > 0 || subagentsRunning > 0 ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          ),
        id: 'agents',
        label: copy.agents,
        onSelect: openAgents,
        title: agentsOpen ? copy.closeAgents : copy.openAgents,
        variant: 'action'
      },
      {
        icon: <Clock className="size-3" />,
        id: 'cron',
        label: copy.cron,
        title: copy.openCron,
        to: CRON_ROUTE,
        variant: 'action'
      }
    ],
    [
      agentsOpen,
      bgFailed,
      bgRunning,
      commandCenterOpen,
      copy,
      openAgents,
      serverConnected,
      serverConnecting,
      subagentsRunning,
      toggleCommandCenter
    ]
  )

  const coreRightStatusbarItems = useMemo<readonly StatusbarItem[]>(
    () => [
      {
        detail: <LiveDuration since={turnStartedAt} />,
        hidden: !busy || !turnStartedAt,
        icon: <Loader2 className="size-3 animate-spin" />,
        id: 'running-timer',
        label: copy.turnRunning,
        title: copy.currentTurnElapsed,
        variant: 'text'
      },
      {
        detail: contextBar || undefined,
        hidden: !contextUsage,
        id: 'context-usage',
        label: contextUsage,
        title: copy.contextUsage,
        variant: 'text'
      },
      {
        detail: <LiveDuration since={sessionStartedAt} />,
        hidden: !sessionStartedAt,
        id: 'session-timer',
        label: copy.session,
        title: copy.runtimeSessionElapsed,
        variant: 'text'
      },
      {
        id: 'model-summary',
        label: (
          <span className="inline-flex min-w-0 items-center gap-0.5">
            <span className="truncate">
              {formatModelStatusLabel(currentModel, {
                fastMode: currentFastMode,
                reasoningEffort: currentReasoningEffort
              })}
            </span>
            <ChevronDown className="size-2.5 shrink-0 opacity-50" />
          </span>
        ),
        ...(modelMenuContent
          ? {
              menuAlign: 'end' as const,
              menuClassName: 'w-64',
              menuContent: modelMenuContent,
              title: currentProvider
                ? copy.modelTitle(currentProvider, currentModel || copy.modelNone)
                : copy.switchModel,
              variant: 'menu' as const
            }
          : {
              onSelect: () => setModelPickerOpen(true),
              title: currentProvider
                ? copy.providerModelTitle(currentProvider, currentModel || copy.noModel)
                : copy.openModelPicker,
              variant: 'action' as const
            })
      },
      versionItem
    ],
    [
      busy,
      contextBar,
      contextUsage,
      copy,
      currentFastMode,
      currentModel,
      currentProvider,
      currentReasoningEffort,
      modelMenuContent,
      sessionStartedAt,
      turnStartedAt,
      versionItem
    ]
  )

  const leftStatusbarItems = useMemo(
    () => [...coreLeftStatusbarItems, ...extraLeftItems],
    [coreLeftStatusbarItems, extraLeftItems]
  )

  const statusbarItems = useMemo(
    () => [...extraRightItems, ...coreRightStatusbarItems],
    [coreRightStatusbarItems, extraRightItems]
  )

  return { leftStatusbarItems, statusbarItems }
}
