import type { AppendMessage, ThreadMessage } from '@assistant-ui/react'
import { type MutableRefObject, useCallback, useRef } from 'react'

import { requestComposerFocus } from '@/app/chat/composer/focus'
import { getProfiles } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { transcribeAudioBlob } from '@/lib/audio'
import { branchGroupForUser, type ChatMessage, chatMessageText, textPart } from '@/lib/chat-messages'
import {
  attachmentDisplayText,
  parseCommandDispatch,
  parseSlashCommand,
  pathLabel,
  sessionTitle,
  SLASH_COMMAND_RE
} from '@/lib/chat-runtime'
import { fileDataUrlFromFile, imageBytesFromFile, isReadableAttachmentPath } from '@/lib/composer-attach'
import {
  type CommandsCatalogLike,
  desktopSlashUnavailableMessage,
  filterDesktopCommandsCatalog,
  isDesktopSlashCommand,
  isModelPickerCommand
} from '@/lib/desktop-slash-commands'
import { fishAudioAttachmentRef, uploadFishAudioAttachment } from '@/lib/fishaudio-session'
import { triggerHaptic } from '@/lib/haptics'
import { setMutableRef } from '@/lib/mutable-ref'
import { isVerxioWeb } from '@/lib/platform'
import { isProviderSetupErrorMessage } from '@/lib/provider-setup-errors'
import { verxioApiEnabled } from '@/lib/verxio-api'
import { preprocessWebLocalContextReferences } from '@/lib/web-local-context'
import { resolveWebLocalWorkspaceCwd } from '@/lib/web-local-fs'
import { setSessionYolo } from '@/lib/yolo-session'
import {
  $composerAttachments,
  addComposerAttachment,
  clearComposerAttachments,
  type ComposerAttachment,
  setComposerDraft,
  terminalContextBlocksFromDraft
} from '@/store/composer'
import { clearNotifications, notify, notifyError } from '@/store/notifications'
import { requestDesktopOnboarding } from '@/store/onboarding'
import { clearPreviewArtifacts } from '@/store/preview-status'
import { $activeGatewayProfile, $newChatProfile, ensureGatewayProfile, normalizeProfileKey } from '@/store/profile'
import {
  $busy,
  $currentCwd,
  $currentModel,
  $messages,
  $sessions,
  $yoloActive,
  setAwaitingResponse,
  setBusy,
  setMessages,
  setModelPickerOpen,
  setSessionPickerOpen,
  setSessions,
  setYoloActive
} from '@/store/session'
import { clearSessionSubagents } from '@/store/subagents'

import type {
  ClientSessionState,
  FileAttachResponse,
  ImageAttachResponse,
  SessionSteerResponse,
  SessionTitleResponse,
  SlashExecResponse
} from '../../types'

function isProviderSetupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  return isProviderSetupErrorMessage(message)
}

async function isByokWithoutSelectedModel(): Promise<boolean> {
  // Hybrid: prompt to pick a model whenever none is selected (hosted or BYOK).
  if (!verxioApiEnabled() || $currentModel.get().trim()) {
    return false
  }

  return true
}

function inlineErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback

  return (raw.match(/Error invoking remote method '[^']+': Error: (.+)$/)?.[1] ?? raw).replace(/^Error:\s*/, '').trim()
}

function isSessionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return /session not found/i.test(message)
}

// The gateway refuses prompt.submit while a turn is running (4009 "session
// busy"). It's a transient concurrency guard, never a user-facing error: a
// submit racing the settle edge after cancel/interrupt (or a rewind mid-turn)
// just waits a beat for the turn to wind down, then lands. Bounded so a
// genuinely stuck turn still surfaces eventually.
const SESSION_BUSY_RETRY_TIMEOUT_MS = 6_000
const SESSION_BUSY_RETRY_INTERVAL_MS = 150

function isSessionBusyError(error: unknown): boolean {
  return /session busy/i.test(error instanceof Error ? error.message : String(error))
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// Retry a gateway call across transient "session busy" so it never reaches the
// user — the turn settles within the deadline and the call lands.
// `isCurrent` lets cancel/stop abandon a retry loop so a cancelled submit can't
// land after the UI has already moved on.
async function withSessionBusyRetry<T>(call: () => Promise<T>, isCurrent?: () => boolean): Promise<T> {
  const deadline = Date.now() + SESSION_BUSY_RETRY_TIMEOUT_MS

  for (;;) {
    if (isCurrent && !isCurrent()) {
      throw new DOMException('Submit cancelled', 'AbortError')
    }

    try {
      return await call()
    } catch (err) {
      if (isSessionBusyError(err) && Date.now() < deadline && (!isCurrent || isCurrent())) {
        await sleep(SESSION_BUSY_RETRY_INTERVAL_MS)

        continue
      }

      throw err
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function isSessionIdCandidate(value: string): boolean {
  const trimmed = value.trim()

  return /^\d{8}_\d{6}_[A-Fa-f0-9]{6}$/.test(trimmed) || /^[A-Fa-f0-9]{32}$/.test(trimmed)
}

interface PromptActionsOptions {
  activeSessionId: string | null
  activeSessionIdRef: MutableRefObject<string | null>
  busyRef: MutableRefObject<boolean>
  branchCurrentSession: () => Promise<boolean>
  createBackendSessionForSend: (preview?: string | null) => Promise<string | null>
  handleSkinCommand: (arg: string) => string
  refreshSessions: () => Promise<void>
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  resumeStoredSession: (storedSessionId: string) => Promise<void> | void
  selectedStoredSessionIdRef: MutableRefObject<string | null>
  startFreshSessionDraft: () => void
  sttEnabled: boolean
  updateSessionState: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
}

interface SubmitTextOptions {
  attachments?: ComposerAttachment[]
  fromQueue?: boolean
}

function renderCommandsCatalog(catalog: CommandsCatalogLike, copy: Translations['desktop']): string {
  const desktopCatalog = filterDesktopCommandsCatalog(catalog)

  const sections = desktopCatalog.categories?.length
    ? desktopCatalog.categories
    : [{ name: copy.desktopCommands, pairs: desktopCatalog.pairs ?? [] }]

  const body = sections
    .filter(section => section.pairs.length > 0)
    .map(section => {
      const rows = section.pairs.map(([cmd, desc]) => `${cmd.padEnd(18)} ${desc}`)

      return [`${section.name}:`, ...rows].join('\n')
    })
    .join('\n\n')

  const tail = [
    desktopCatalog.skill_count ? copy.skillCommandsAvailable(desktopCatalog.skill_count) : '',
    desktopCatalog.warning ? copy.warningLine(desktopCatalog.warning) : ''
  ]
    .filter(Boolean)
    .join('\n')

  return [body || 'No desktop commands available.', tail].filter(Boolean).join('\n\n')
}

function slashStatusText(command: string, output: string): string {
  return [`slash:${command}`, output.trim()].filter(Boolean).join('\n')
}

function appendText(message: AppendMessage): string {
  return message.content
    .map(part => ('text' in part ? part.text : ''))
    .join('')
    .trim()
}

function visibleUserOrdinal(messages: readonly ChatMessage[], end: number): number {
  return messages.slice(0, end).filter(m => m.role === 'user' && !m.hidden).length
}

export function usePromptActions({
  activeSessionId,
  activeSessionIdRef,
  busyRef,
  branchCurrentSession,
  createBackendSessionForSend,
  handleSkinCommand,
  refreshSessions,
  requestGateway,
  resumeStoredSession,
  selectedStoredSessionIdRef,
  startFreshSessionDraft,
  sttEnabled,
  updateSessionState
}: PromptActionsOptions) {
  const { t } = useI18n()
  const copy = t.desktop
  const statusbarCopy = t.shell.statusbar
  // Bumped by cancelRun so an in-flight submit (session create / attach / submit)
  // abandons before it can re-arm busy or hit the gateway after Stop.
  const submitEpochRef = useRef(0)

  const appendSessionTextMessage = useCallback(
    (sessionId: string, role: ChatMessage['role'], text: string) => {
      const body = text.trim()

      if (!body) {
        return
      }

      updateSessionState(
        sessionId,
        state => ({
          ...state,
          messages: [
            ...state.messages,
            {
              id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role,
              parts: [textPart(body)]
            }
          ]
        }),
        selectedStoredSessionIdRef.current
      )
    },
    [selectedStoredSessionIdRef, updateSessionState]
  )

  const syncImageAttachmentsForSubmit = useCallback(
    async (
      sessionId: string,
      attachments: ComposerAttachment[],
      options: { updateComposerAttachments?: boolean } = {}
    ): Promise<ComposerAttachment[]> => {
      const updateComposerAttachments = options.updateComposerAttachments ?? true

      return Promise.all(
        attachments.map(async attachment => {
          if (attachment.kind !== 'image') {
            return attachment
          }

          if (
            attachment.attachedSessionId === sessionId &&
            attachment.path &&
            isReadableAttachmentPath(attachment.path)
          ) {
            return attachment
          }

          const label = attachment.label || (attachment.path ? pathLabel(attachment.path) : 'image')
          let result: ImageAttachResponse

          if (attachment.uploadFile) {
            const payload = await imageBytesFromFile(attachment.uploadFile)
            result = await requestGateway<ImageAttachResponse>('image.attach_bytes', {
              session_id: sessionId,
              content_base64: payload.contentBase64,
              filename: payload.filename
            })
          } else if (attachment.path && isReadableAttachmentPath(attachment.path)) {
            // Prefer byte upload so remote gateways (web + desktop remote) work.
            // Fall back to path attach for local desktop where the gateway shares disk.
            try {
              const dataUrl = await window.hermesDesktop?.readFileDataUrl(attachment.path)
              const contentBase64 = dataUrl ? dataUrl.slice(dataUrl.indexOf(',') + 1) : ''

              if (contentBase64) {
                result = await requestGateway<ImageAttachResponse>('image.attach_bytes', {
                  session_id: sessionId,
                  content_base64: contentBase64,
                  filename: pathLabel(attachment.path)
                })
              } else {
                result = await requestGateway<ImageAttachResponse>('image.attach', {
                  session_id: sessionId,
                  path: attachment.path
                })
              }
            } catch {
              result = await requestGateway<ImageAttachResponse>('image.attach', {
                session_id: sessionId,
                path: attachment.path
              })
            }
          } else {
            throw new Error(`Could not attach ${label}. Re-add the image from the picker so Verxio can upload it.`)
          }

          if (!result.attached) {
            throw new Error(result.message || `Could not attach ${label}`)
          }

          const attachedPath = result.path || attachment.path

          const synced: ComposerAttachment = {
            ...attachment,
            attachedSessionId: sessionId,
            label: attachedPath ? pathLabel(attachedPath) : attachment.label,
            path: attachedPath,
            uploadFile: undefined
          }

          if (updateComposerAttachments) {
            addComposerAttachment(synced)
          }

          return synced
        })
      )
    },
    [requestGateway]
  )

  const syncFileAttachmentsForSubmit = useCallback(
    async (
      sessionId: string,
      attachments: ComposerAttachment[],
      options: { updateComposerAttachments?: boolean } = {}
    ): Promise<ComposerAttachment[]> => {
      const updateComposerAttachments = options.updateComposerAttachments ?? true

      return Promise.all(
        attachments.map(async attachment => {
          if (attachment.kind !== 'file') {
            return attachment
          }

          if (attachment.attachedSessionId === sessionId && attachment.refText?.startsWith('@file:')) {
            // Already staged on the gateway (has a real upload). Skip name-only refs.
            if (!attachment.uploadFile) {
              return attachment
            }
          }

          if (!attachment.uploadFile) {
            // Path-only context refs (project tree) stay as @file: text — no upload.
            return attachment
          }

          const label = attachment.label || attachment.uploadFile.name || 'file'
          const payload = await fileDataUrlFromFile(attachment.uploadFile)

          const result = await requestGateway<FileAttachResponse>('file.attach', {
            data_url: payload.dataUrl,
            name: payload.filename,
            session_id: sessionId
          })

          if (!result.attached || !result.ref_text) {
            throw new Error(result.message || `Could not attach ${label}`)
          }

          const synced: ComposerAttachment = {
            ...attachment,
            attachedSessionId: sessionId,
            label: result.name || label,
            path: result.path || attachment.path,
            refText: result.ref_text,
            uploadFile: undefined
          }

          if (updateComposerAttachments) {
            addComposerAttachment(synced)
          }

          return synced
        })
      )
    },
    [requestGateway]
  )

  const syncAudioAttachmentsForSubmit = useCallback(
    async (
      sessionId: string,
      attachments: ComposerAttachment[],
      options: { updateComposerAttachments?: boolean } = {}
    ): Promise<ComposerAttachment[]> => {
      const updateComposerAttachments = options.updateComposerAttachments ?? true

      return Promise.all(
        attachments.map(async attachment => {
          if (attachment.kind !== 'audio') {
            return attachment
          }

          if (attachment.attachedSessionId === sessionId && attachment.refText) {
            return attachment
          }

          if (!attachment.uploadFile) {
            throw new Error(copy.audioAttachmentExpired)
          }

          const uploaded = await uploadFishAudioAttachment(attachment.uploadFile, sessionId, requestGateway)

          const synced: ComposerAttachment = {
            ...attachment,
            attachedSessionId: sessionId,
            digest: uploaded.digest,
            expiresAt: uploaded.expires_at,
            refText: fishAudioAttachmentRef(uploaded.handle),
            uploadFile: undefined
          }

          if (updateComposerAttachments) {
            addComposerAttachment(synced)
          }

          return synced
        })
      )
    },
    [copy.audioAttachmentExpired, requestGateway]
  )

  const submitPromptText = useCallback(
    async (rawText: string, options?: SubmitTextOptions) => {
      const visibleText = rawText.trim()
      const usingComposerAttachments = !options?.attachments
      const attachments = options?.attachments ?? $composerAttachments.get()

      const contextRefs = attachments
        .map(a => a.refText)
        .filter(Boolean)
        .join('\n')

      const terminalContextBlocks = terminalContextBlocksFromDraft(rawText).join('\n\n')
      const hasImage = attachments.some(a => a.kind === 'image')
      const hasAudio = attachments.some(a => a.kind === 'audio')
      const attachmentRefs = attachments.map(attachmentDisplayText).filter((r): r is string => Boolean(r))

      const text =
        [contextRefs, terminalContextBlocks, visibleText].filter(Boolean).join('\n\n') ||
        (hasImage ? 'What do you see in this image?' : hasAudio ? copy.useAttachedAudio : '')

      // Queue drains fire on the busy→false settle edge, where busyRef (synced
      // from $busy by a separate effect) may still read true — honoring it would
      // bounce the drained send. The drain lock serializes them; the user path
      // keeps the guard so a stray Enter mid-turn can't double-submit.
      if (!text || (!options?.fromQueue && busyRef.current)) {
        return false
      }

      if (await isByokWithoutSelectedModel()) {
        notify({
          kind: 'error',
          title: statusbarCopy.switchModel,
          message: copy.noModelSelected
        })
        setModelPickerOpen(true)

        return false
      }

      const submitEpoch = ++submitEpochRef.current
      const isCurrentSubmit = () => submitEpochRef.current === submitEpoch

      const optimisticId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      const userMessage: ChatMessage = {
        id: optimisticId,
        role: 'user',
        parts: [textPart(visibleText || (attachmentRefs.length ? '' : attachments.map(a => a.label).join(', ')))],
        attachmentRefs
      }

      const releaseBusy = () => {
        setMutableRef(busyRef, false)
        setBusy(false)
        setAwaitingResponse(false)
      }

      // Idempotent optimistic insert — re-running with the resolved sessionId
      // after createBackendSessionForSend just overwrites with the same id.
      const seedOptimistic = (sid: string) =>
        updateSessionState(
          sid,
          state => ({
            ...state,
            messages: state.messages.some(m => m.id === optimisticId)
              ? state.messages
              : [...state.messages, userMessage],
            busy: true,
            awaitingResponse: true,
            pendingBranchGroup: null,
            sawAssistantPayload: false,
            // Fresh submit = new turn — clear any leftover interrupt flag, else
            // mutateStream/completeAssistantMessage drop every delta of this turn
            // (what made drained-after-interrupt sends go silent).
            interrupted: false
          }),
          selectedStoredSessionIdRef.current
        )

      const dropOptimistic = (sid: null | string) => {
        if (!sid) {
          setMessages(current => current.filter(m => m.id !== optimisticId))

          return
        }

        updateSessionState(
          sid,
          state => ({
            ...state,
            messages: state.messages.filter(m => m.id !== optimisticId),
            busy: false,
            awaitingResponse: false,
            pendingBranchGroup: null
          }),
          selectedStoredSessionIdRef.current
        )
      }

      setMutableRef(busyRef, true)
      setBusy(true)
      setAwaitingResponse(true)
      clearNotifications()

      let sessionId: null | string = activeSessionId

      if (sessionId) {
        seedOptimistic(sessionId)
      } else {
        setMessages(current => [...current, userMessage])
      }

      if (!sessionId) {
        try {
          sessionId = await createBackendSessionForSend(visibleText)
        } catch (err) {
          if (!isCurrentSubmit()) {
            dropOptimistic(null)

            return false
          }

          dropOptimistic(null)
          releaseBusy()
          notifyError(err, copy.sessionUnavailable)

          return false
        }

        if (!isCurrentSubmit()) {
          dropOptimistic(sessionId)
          // cancelRun already released busy for the live UI; don't re-arm it.

          return false
        }

        if (!sessionId) {
          dropOptimistic(null)
          releaseBusy()
          notify({ kind: 'error', title: copy.sessionUnavailable, message: copy.createSessionFailed })

          return false
        }

        seedOptimistic(sessionId)
      }

      try {
        if (!isCurrentSubmit()) {
          dropOptimistic(sessionId)

          return false
        }

        let syncedAttachments = await syncAudioAttachmentsForSubmit(sessionId, attachments, {
          updateComposerAttachments: usingComposerAttachments
        })

        if (!isCurrentSubmit()) {
          dropOptimistic(sessionId)

          return false
        }

        syncedAttachments = await syncImageAttachmentsForSubmit(sessionId, syncedAttachments, {
          updateComposerAttachments: usingComposerAttachments
        })

        if (!isCurrentSubmit()) {
          dropOptimistic(sessionId)

          return false
        }

        syncedAttachments = await syncFileAttachmentsForSubmit(sessionId, syncedAttachments, {
          updateComposerAttachments: usingComposerAttachments
        })

        if (!isCurrentSubmit()) {
          dropOptimistic(sessionId)

          return false
        }

        // Image attachments are drained by prompt.submit from session.attached_images.
        // Only include text refs for non-image chips (files/audio/folders/urls).
        const syncedRefs = syncedAttachments
          .filter(attachment => attachment.kind !== 'image')
          .map(attachmentDisplayText)
          .filter((ref): ref is string => Boolean(ref))

        let submitText =
          [syncedRefs.join('\n'), terminalContextBlocks, visibleText].filter(Boolean).join('\n\n') ||
          (hasImage ? 'What do you see in this image?' : hasAudio ? copy.useAttachedAudio : text)

        if (isVerxioWeb()) {
          const webLocalCwd = resolveWebLocalWorkspaceCwd($currentCwd.get())

          if (webLocalCwd) {
            submitText = await preprocessWebLocalContextReferences(submitText, webLocalCwd)
          }
        }

        if (!isCurrentSubmit()) {
          dropOptimistic(sessionId)

          return false
        }

        // After deploy/runtime wipe, reconnect restores the WS but the tab may
        // still hold a dead in-memory runtime session id. Resume the durable
        // stored session once and retry — same recovery as sleep/wake on desktop.
        // Also ride out transient 4009 "session busy" after a cancel/interrupt
        // while the previous turn is still winding down.
        try {
          await withSessionBusyRetry(
            () => requestGateway('prompt.submit', { session_id: sessionId, text: submitText }),
            isCurrentSubmit
          )
        } catch (firstErr) {
          if (isAbortError(firstErr) || !isCurrentSubmit()) {
            dropOptimistic(sessionId)

            return false
          }

          if (!isSessionNotFoundError(firstErr) || !selectedStoredSessionIdRef.current) {
            throw firstErr
          }

          await resumeStoredSession(selectedStoredSessionIdRef.current)
          const recoveredId = activeSessionIdRef.current

          if (!recoveredId) {
            throw firstErr
          }

          if (!isCurrentSubmit()) {
            dropOptimistic(sessionId)

            return false
          }

          sessionId = recoveredId
          seedOptimistic(recoveredId)
          await withSessionBusyRetry(
            () => requestGateway('prompt.submit', { session_id: recoveredId, text: submitText }),
            isCurrentSubmit
          )
        }

        if (!isCurrentSubmit()) {
          return false
        }

        if (usingComposerAttachments) {
          clearComposerAttachments()
        }

        return true
      } catch (err) {
        if (isAbortError(err) || !isCurrentSubmit()) {
          return false
        }

        // A queued drain that raced a not-yet-settled turn gets a transient
        // "session busy" (4009). Don't surface an error bubble/toast — the entry
        // stays queued and the composer's bounded auto-drain retries when idle.
        if (options?.fromQueue && isSessionBusyError(err)) {
          releaseBusy()

          return false
        }

        const message = inlineErrorMessage(err, copy.promptFailed)

        releaseBusy()
        updateSessionState(sessionId, state => ({
          ...state,
          messages: [
            ...state.messages,
            {
              id: `assistant-error-${Date.now()}`,
              role: 'assistant',
              parts: [],
              error: message || copy.promptFailed,
              branchGroupId: state.pendingBranchGroup ?? undefined
            }
          ],
          busy: false,
          awaitingResponse: false,
          pendingBranchGroup: null,
          sawAssistantPayload: true
        }))

        if (isProviderSetupError(err)) {
          requestDesktopOnboarding(copy.providerCredentialRequired)

          return false
        }

        notifyError(err, copy.promptFailed)

        return false
      }
    },
    [
      activeSessionId,
      activeSessionIdRef,
      busyRef,
      copy,
      createBackendSessionForSend,
      requestGateway,
      resumeStoredSession,
      selectedStoredSessionIdRef,
      statusbarCopy.switchModel,
      syncImageAttachmentsForSubmit,
      syncFileAttachmentsForSubmit,
      syncAudioAttachmentsForSubmit,
      updateSessionState
    ]
  )

  const executeSlashCommand = useCallback(
    async (rawCommand: string, options?: { sessionId?: string; recordInput?: boolean }) => {
      const runSlash = async (commandText: string, sessionHint?: string, recordInput = true): Promise<void> => {
        const command = commandText.trim()
        const { name, arg } = parseSlashCommand(command)
        const normalizedName = name.toLowerCase()

        if (!name) {
          const sessionId = sessionHint || activeSessionIdRef.current || (await createBackendSessionForSend())

          if (sessionId) {
            appendSessionTextMessage(sessionId, 'system', copy.emptySlashCommand)
          }

          return
        }

        if (normalizedName === 'new' || normalizedName === 'reset') {
          startFreshSessionDraft()

          return
        }

        if (normalizedName === 'branch' || normalizedName === 'fork') {
          await branchCurrentSession()

          return
        }

        // /yolo maps to the status-bar YOLO control — a per-session approval
        // bypass, same scope as the TUI's Shift+Tab. With no session yet we arm
        // it locally; the session-create path applies it on the first message.
        if (normalizedName === 'yolo') {
          const sid = sessionHint || activeSessionIdRef.current
          const next = !$yoloActive.get()

          if (!sid) {
            setYoloActive(next)
            notify({ kind: 'success', message: next ? copy.yoloArmed : copy.yoloOff })

            return
          }

          try {
            const active = await setSessionYolo(requestGateway, sid, next)
            appendSessionTextMessage(sid, 'system', copy.yoloSystem(active))
          } catch {
            notify({ kind: 'error', title: copy.yoloTitle, message: copy.yoloToggleFailed })
          }

          return
        }

        // /model opens the desktop model picker overlay — the same full
        // provider+model picker reachable from the status-bar model button —
        // instead of the headless prompt_toolkit modal the slash worker can't
        // render. With explicit args (`/model <name> [--provider ...]`) run the
        // switch directly through slash.exec so power users can still type it.
        if (['resume', 'sessions', 'switch'].includes(normalizedName)) {
          const query = arg.trim()

          if (!query) {
            setSessionPickerOpen(true)

            return
          }

          const sessions = $sessions.get()
          const lower = query.toLowerCase()

          const match =
            sessions.find(session => session.id === query) ||
            sessions.find(session => sessionTitle(session).toLowerCase().includes(lower)) ||
            sessions.find(session => (session.preview ?? '').toLowerCase().includes(lower))

          if (!match) {
            if (isSessionIdCandidate(query)) {
              await resumeStoredSession(query)

              return
            }

            notify({ kind: 'error', message: copy.resumeFailed })

            return
          }

          await resumeStoredSession(match.id)

          return
        }

        if (isModelPickerCommand(`/${normalizedName}`)) {
          if (!arg.trim()) {
            setModelPickerOpen(true)

            return
          }

          const sid = sessionHint || activeSessionIdRef.current || (await createBackendSessionForSend())

          if (!sid) {
            notify({ kind: 'error', title: 'Session unavailable', message: 'Could not create a new session' })

            return
          }

          try {
            const result = await requestGateway<SlashExecResponse>('slash.exec', {
              session_id: sid,
              command: command.replace(/^\/+/, '')
            })

            const body = result?.output || `/${name}: model switched`
            appendSessionTextMessage(sid, 'system', recordInput ? slashStatusText(command, body) : body)
          } catch (err) {
            appendSessionTextMessage(sid, 'system', `error: ${err instanceof Error ? err.message : String(err)}`)
          }

          return
        }

        if (normalizedName === 'skin' && !sessionHint && !activeSessionIdRef.current) {
          notify({ kind: 'success', message: handleSkinCommand(arg) })

          return
        }

        // /profile selects which profile new chats open in — no app relaunch.
        // A profile is per-session now, so an existing thread can't change its
        // profile mid-stream; `/profile <name>` instead points the next new chat
        // (and the current empty draft) at that profile's backend.
        if (normalizedName === 'profile') {
          const target = arg.trim()
          const current = normalizeProfileKey($activeGatewayProfile.get())

          if (!target) {
            notify({
              kind: 'success',
              message: copy.profileStatus(current)
            })

            return
          }

          try {
            const { profiles } = await getProfiles()
            const match = profiles.find(profile => profile.name === target)

            if (!match) {
              notify({
                kind: 'error',
                title: copy.unknownProfile,
                message: copy.noProfileNamed(target, profiles.map(profile => profile.name).join(', '))
              })

              return
            }

            const key = normalizeProfileKey(match.name)

            $newChatProfile.set(key)
            // Swap the live gateway now so an empty draft sends into this
            // profile immediately; an existing thread keeps its own profile.
            await ensureGatewayProfile(key)
            notify({ kind: 'success', message: copy.newChatsProfile(match.name) })
          } catch (err) {
            notifyError(err, copy.setProfileFailed)
          }

          return
        }

        const sessionId = sessionHint || activeSessionIdRef.current || (await createBackendSessionForSend())

        if (!sessionId) {
          notify({
            kind: 'error',
            title: copy.sessionUnavailable,
            message: copy.createSessionFailed
          })

          return
        }

        const renderSlashOutput = (text: string) =>
          appendSessionTextMessage(sessionId, 'system', recordInput ? slashStatusText(command, text) : text)

        // /title <name> renames the session. Route through the gateway's
        // `session.title` RPC — the same path the TUI uses — NOT the REST
        // renameSession endpoint and NOT the slash worker.
        //
        // Why not the slash worker: it's a separate CLI subprocess whose
        // SQLite write to the shared state.db can silently fail (notably on
        // Windows), and it never refreshes the sidebar.
        //
        // Why not REST renameSession: `sessionId` here is the *runtime* session
        // id returned by session.create — it is NOT the stored DB `sessions.id`,
        // and session.create deliberately does not persist a DB row until the
        // first turn. The REST PATCH endpoint resolves against the sessions
        // table, so a runtime id (or a brand-new, not-yet-persisted session)
        // 404s with "Session not found" on every platform. See #38508 / #38576.
        //
        // session.title maps the runtime id to the in-memory session, writes
        // through the gateway's own DB connection, and QUEUES the title
        // (`pending: true`) when the row isn't persisted yet — so it works for a
        // fresh chat too. refreshSessions() then pulls the authoritative title
        // back into the sidebar. A bare `/title` (no arg) still falls through to
        // the worker to display the current title.
        if (normalizedName === 'title' && arg) {
          try {
            const result = await requestGateway<SessionTitleResponse>('session.title', {
              session_id: sessionId,
              title: arg
            })

            const finalTitle = (result?.title || arg).trim()
            const queued = result?.pending === true

            setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: finalTitle || null } : s)))
            await refreshSessions().catch(() => undefined)
            renderSlashOutput(
              finalTitle
                ? `Session title set: ${finalTitle}${queued ? ' (queued while session initializes)' : ''}`
                : 'Session title cleared.'
            )
          } catch (err) {
            renderSlashOutput(`error: ${err instanceof Error ? err.message : String(err)}`)
          }

          return
        }

        if (normalizedName === 'skin') {
          renderSlashOutput(handleSkinCommand(arg))

          return
        }

        if (name === 'help' || name === 'commands') {
          try {
            const catalog = await requestGateway<CommandsCatalogLike>('commands.catalog', { session_id: sessionId })

            renderSlashOutput(renderCommandsCatalog(catalog, copy))
          } catch (err) {
            renderSlashOutput(`error: ${err instanceof Error ? err.message : String(err)}`)
          }

          return
        }

        if (!isDesktopSlashCommand(name)) {
          renderSlashOutput(desktopSlashUnavailableMessage(name) || `/${name} is not available in the desktop app.`)

          return
        }

        try {
          const result = await requestGateway<SlashExecResponse>('slash.exec', {
            session_id: sessionId,
            command: command.replace(/^\/+/, '')
          })

          const body = result?.output || `/${name}: no output`
          renderSlashOutput(result?.warning ? `warning: ${result.warning}\n${body}` : body)

          return
        } catch {
          // Fall back to command.dispatch for skill/send/alias directives.
        }

        try {
          const dispatch = parseCommandDispatch(
            await requestGateway<unknown>('command.dispatch', {
              session_id: sessionId,
              name,
              arg
            })
          )

          if (!dispatch) {
            renderSlashOutput('error: invalid response: command.dispatch')

            return
          }

          if (dispatch.type === 'exec' || dispatch.type === 'plugin') {
            renderSlashOutput(dispatch.output ?? '(no output)')

            return
          }

          if (dispatch.type === 'alias') {
            await runSlash(`/${dispatch.target}${arg ? ` ${arg}` : ''}`, sessionId, false)

            return
          }

          if (dispatch.type === 'prefill') {
            setComposerDraft(dispatch.message)
            requestComposerFocus('main')
            renderSlashOutput(dispatch.notice || `/${name}: loaded into composer`)

            return
          }

          const message = ('message' in dispatch ? dispatch.message : '')?.trim() ?? ''

          if (!message) {
            renderSlashOutput(
              `/${name}: ${dispatch.type === 'skill' ? 'skill payload missing message' : 'empty message'}`
            )

            return
          }

          if (dispatch.type === 'skill') {
            renderSlashOutput(`⚡ loading skill: ${dispatch.name}`)
          }

          if (busyRef.current) {
            renderSlashOutput('session busy — /interrupt the current turn before sending this command')

            return
          }

          await submitPromptText(message)
        } catch (err) {
          renderSlashOutput(`error: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      await runSlash(rawCommand, options?.sessionId, options?.recordInput ?? true)
    },
    [
      activeSessionIdRef,
      appendSessionTextMessage,
      branchCurrentSession,
      busyRef,
      copy,
      createBackendSessionForSend,
      handleSkinCommand,
      refreshSessions,
      requestGateway,
      resumeStoredSession,
      startFreshSessionDraft,
      submitPromptText
    ]
  )

  const submitText = useCallback(
    async (rawText: string, options?: SubmitTextOptions) => {
      const visibleText = rawText.trim()
      const attachments = options?.attachments ?? $composerAttachments.get()

      if (!attachments.length && SLASH_COMMAND_RE.test(visibleText)) {
        triggerHaptic('selection')
        await executeSlashCommand(visibleText)

        return true
      }

      return await submitPromptText(rawText, options)
    },
    [executeSlashCommand, submitPromptText]
  )

  const transcribeVoiceAudio = useCallback(
    async (audio: Blob) => {
      if (!sttEnabled) {
        throw new Error(copy.sttDisabled)
      }

      return await transcribeAudioBlob(audio)
    },
    [copy.sttDisabled, sttEnabled]
  )

  const cancelRun = useCallback(async () => {
    const sessionId = activeSessionId || activeSessionIdRef.current

    // Invalidate any in-flight submitPromptText so session create / attach /
    // prompt.submit can't re-arm busy after Stop.
    submitEpochRef.current += 1

    const releaseBusy = () => {
      setMutableRef(busyRef, false)
      setBusy(false)
    }

    setAwaitingResponse(false)

    const finalizeMessages = (messages: ChatMessage[], streamId?: string | null) =>
      messages
        .filter(message => !((message.pending || message.id === streamId) && !chatMessageText(message).trim()))
        .map(message => (message.pending || message.id === streamId ? { ...message, pending: false } : message))

    if (!sessionId) {
      releaseBusy()
      setMessages(finalizeMessages($messages.get()))

      return
    }

    updateSessionState(sessionId, state => {
      const streamId = state.streamId
      const messages = finalizeMessages(state.messages, streamId)

      return {
        ...state,
        messages,
        busy: false,
        awaitingResponse: false,
        streamId: null,
        pendingBranchGroup: null,
        interrupted: true
      }
    })

    clearSessionSubagents(sessionId)

    try {
      await requestGateway('session.interrupt', { session_id: sessionId })
      releaseBusy()
    } catch (err) {
      let stopError = err

      if (isSessionNotFoundError(err) && selectedStoredSessionIdRef.current) {
        try {
          const resumed = await requestGateway<{ session_id: string }>('session.resume', {
            session_id: selectedStoredSessionIdRef.current,
            use_current_model: true
          })

          const recoveredId = resumed?.session_id

          if (recoveredId) {
            activeSessionIdRef.current = recoveredId
            await requestGateway('session.interrupt', { session_id: recoveredId })
            releaseBusy()

            return
          }
        } catch (resumeErr) {
          stopError = resumeErr
        }
      }

      releaseBusy()
      notifyError(stopError, copy.stopFailed)
    }
  }, [
    activeSessionId,
    activeSessionIdRef,
    busyRef,
    copy.stopFailed,
    requestGateway,
    selectedStoredSessionIdRef,
    updateSessionState
  ])

  // Steer = nudge the live turn without interrupting: the gateway appends the
  // text to the next tool result so the model reads it on its next iteration
  // (desktop parity with `/steer`). Returns false on reject (no live tool
  // window) so the caller can fall back to queueing the words for the next turn.
  const steerPrompt = useCallback(
    async (rawText: string): Promise<boolean> => {
      const text = rawText.trim()
      const sessionId = activeSessionId || activeSessionIdRef.current

      if (!text || !sessionId) {
        return false
      }

      try {
        const result = await requestGateway<SessionSteerResponse>('session.steer', { session_id: sessionId, text })

        if (result?.status === 'queued') {
          triggerHaptic('submit')
          // Inline note (not a toast) so the nudge lives in the transcript next
          // to the turn it steered. The `steer:` prefix is rendered as a codicon
          // row by SystemMessage (see STEER_NOTE_RE), same style as slash output.
          appendSessionTextMessage(sessionId, 'system', `steer:${text}`)

          return true
        }
      } catch {
        // Swallow — caller queues the text so nothing is lost.
      }

      return false
    },
    [activeSessionId, activeSessionIdRef, appendSessionTextMessage, requestGateway]
  )

  const reloadFromMessage = useCallback(
    async (parentId: string | null) => {
      if (!activeSessionId || $busy.get()) {
        return
      }

      const messages = $messages.get()
      const parentIndex = parentId ? messages.findIndex(message => message.id === parentId) : messages.length - 1

      const userIndex =
        parentIndex >= 0
          ? [...messages.slice(0, parentIndex + 1)].reverse().findIndex(message => message.role === 'user')
          : -1

      if (userIndex < 0) {
        return
      }

      const absoluteUserIndex = parentIndex - userIndex
      const userMessage = messages[absoluteUserIndex]
      const userText = userMessage ? chatMessageText(userMessage).trim() : ''

      if (!userText) {
        return
      }

      const targetAssistant =
        parentId && messages[parentIndex]?.role === 'assistant'
          ? messages[parentIndex]
          : messages.slice(absoluteUserIndex + 1).find(message => message.role === 'assistant')

      const branchGroupId = targetAssistant?.branchGroupId ?? branchGroupForUser(userMessage)
      const truncateBeforeUserOrdinal = visibleUserOrdinal(messages, absoluteUserIndex)

      clearNotifications()
      updateSessionState(activeSessionId, state => {
        const nextUserIndex = state.messages.findIndex(
          (message, index) => index > absoluteUserIndex && message.role === 'user'
        )

        const end = nextUserIndex < 0 ? state.messages.length : nextUserIndex

        return {
          ...state,
          busy: true,
          awaitingResponse: true,
          pendingBranchGroup: branchGroupId,
          sawAssistantPayload: false,
          interrupted: false,
          messages: [
            ...state.messages.slice(0, absoluteUserIndex + 1),
            ...state.messages
              .slice(absoluteUserIndex + 1, end)
              .map(message => (message.role === 'assistant' ? { ...message, branchGroupId, hidden: true } : message))
          ]
        }
      })

      try {
        await requestGateway('prompt.submit', {
          session_id: activeSessionId,
          text: userText,
          truncate_before_user_ordinal: truncateBeforeUserOrdinal
        })
      } catch (err) {
        updateSessionState(activeSessionId, state => ({
          ...state,
          busy: false,
          awaitingResponse: false
        }))
        notifyError(err, copy.regenerateFailed)
      }
    },
    [activeSessionId, copy.regenerateFailed, requestGateway, updateSessionState]
  )

  const submitRewindPrompt = useCallback(
    async (sessionId: string, text: string, truncateOrdinal: number | undefined, wasRunning: boolean) => {
      if (wasRunning) {
        try {
          await requestGateway('session.interrupt', { session_id: sessionId })
        } catch {
          // Best-effort — the busy-retry below still gates the submit.
        }
      }

      await withSessionBusyRetry(() =>
        requestGateway('prompt.submit', {
          session_id: sessionId,
          text,
          ...(truncateOrdinal !== undefined && { truncate_before_user_ordinal: truncateOrdinal })
        })
      )
    },
    [requestGateway]
  )

  const restoreToMessage = useCallback(
    async (messageId: string) => {
      const sessionId = activeSessionId || activeSessionIdRef.current

      if (!sessionId) {
        return
      }

      const messages = $messages.get()
      const sourceIndex = messages.findIndex(m => m.id === messageId)
      const source = messages[sourceIndex]

      if (!source || source.role !== 'user') {
        return
      }

      const text = chatMessageText(source).trim()

      if (!text) {
        return
      }

      const wasRunning = $busy.get()
      const truncateBeforeUserOrdinal = visibleUserOrdinal(messages, sourceIndex)

      clearPreviewArtifacts(sessionId)

      clearNotifications()
      setMutableRef(busyRef, true)
      setBusy(true)
      setAwaitingResponse(true)
      updateSessionState(sessionId, state => ({
        ...state,
        busy: true,
        awaitingResponse: true,
        pendingBranchGroup: null,
        sawAssistantPayload: false,
        interrupted: false,
        messages: state.messages.slice(0, sourceIndex + 1)
      }))

      try {
        await submitRewindPrompt(sessionId, text, truncateBeforeUserOrdinal, wasRunning)
      } catch (err) {
        setMutableRef(busyRef, false)
        setBusy(false)
        setAwaitingResponse(false)
        updateSessionState(sessionId, state => ({ ...state, busy: false, awaitingResponse: false }))
        throw err
      }
    },
    [activeSessionId, activeSessionIdRef, busyRef, submitRewindPrompt, updateSessionState]
  )

  const editMessage = useCallback(
    async (edited: AppendMessage) => {
      const sessionId = activeSessionId || activeSessionIdRef.current
      const sourceId = edited.sourceId || edited.parentId
      const text = appendText(edited)

      if (!sessionId || !sourceId || !text || edited.role !== 'user') {
        return
      }

      const messages = $messages.get()
      const sourceIndex = messages.findIndex(m => m.id === sourceId)
      const source = messages[sourceIndex]

      if (!source || source.role !== 'user' || chatMessageText(source).trim() === text) {
        return
      }

      // Sending an edit is a revert: rewind to this prompt and re-run with the
      // new text. It can fire mid-turn, so capture the live state — the submit
      // helper interrupts first when a turn is running.
      const wasRunning = $busy.get()

      // Failed turn: optimistic user msg never reached the gateway, so truncating
      // by ordinal would 422. Submit as a plain resend instead.
      const nextMessage = messages[sourceIndex + 1]
      const isFailedTurn = nextMessage?.role === 'assistant' && Boolean(nextMessage.error)
      const editedMessage: ChatMessage = { ...source, parts: [textPart(text)] }

      clearPreviewArtifacts(sessionId)

      clearNotifications()
      setMutableRef(busyRef, true)
      setBusy(true)
      setAwaitingResponse(true)
      updateSessionState(sessionId, state => ({
        ...state,
        busy: true,
        awaitingResponse: true,
        pendingBranchGroup: null,
        sawAssistantPayload: false,
        interrupted: false,
        messages: [...state.messages.slice(0, sourceIndex), editedMessage]
      }))

      const isStaleTargetError = (err: unknown) =>
        /no longer in session history|not in session history/i.test(err instanceof Error ? err.message : String(err))

      try {
        await submitRewindPrompt(
          sessionId,
          text,
          isFailedTurn ? undefined : visibleUserOrdinal(messages, sourceIndex),
          wasRunning
        )
      } catch (err) {
        let surfaced = err

        if (!isFailedTurn && isStaleTargetError(err)) {
          try {
            // Already interrupted on the first attempt — submit as a plain resend.
            await submitRewindPrompt(sessionId, text, undefined, false)

            return
          } catch (retryErr) {
            surfaced = retryErr
          }
        }

        setMutableRef(busyRef, false)
        setBusy(false)
        setAwaitingResponse(false)
        updateSessionState(sessionId, state => ({ ...state, busy: false, awaitingResponse: false }))
        notifyError(surfaced, copy.editFailed)
      }
    },
    [activeSessionId, activeSessionIdRef, busyRef, copy.editFailed, submitRewindPrompt, updateSessionState]
  )

  const handleThreadMessagesChange = useCallback(
    (nextMessages: readonly ThreadMessage[]) => {
      const visibleIds = new Set(nextMessages.map(m => m.id))
      const sessionId = activeSessionIdRef.current

      if (!sessionId) {
        return
      }

      updateSessionState(sessionId, state => {
        let changed = false

        const messages = state.messages.map(message => {
          if (message.role !== 'assistant' || !message.branchGroupId) {
            return message
          }

          const hidden = !visibleIds.has(message.id)

          if (message.hidden === hidden) {
            return message
          }

          changed = true

          return { ...message, hidden }
        })

        return changed ? { ...state, messages } : state
      })
    },
    [activeSessionIdRef, updateSessionState]
  )

  return {
    cancelRun,
    editMessage,
    handleThreadMessagesChange,
    reloadFromMessage,
    restoreToMessage,
    steerPrompt,
    submitText,
    transcribeVoiceAudio
  }
}
