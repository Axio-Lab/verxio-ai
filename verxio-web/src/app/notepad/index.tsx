import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { VerxioWordmark } from '@/components/verxio-wordmark'
import type { DesktopCaptureSource } from '@/global'
import { NOTEPAD_RECORDING_BITS_PER_SECOND, transcribeAudioBlob } from '@/lib/audio'
import { isVerxioDesktop } from '@/lib/platform'
import { cn } from '@/lib/utils'
import {
  createNotepadFolder,
  createNotepadNote,
  deleteNotepadFolder,
  deleteNotepadNote,
  getPublicNotepadShare,
  listNotepad,
  revokeNotepadShare,
  shareNotepadNote,
  summarizeNotepadNote,
  updateNotepadNote,
  verxioApiBaseUrl,
  type VerxioNotepadFolder,
  type VerxioNotepadNote,
  type VerxioNotepadNoteInput,
  type VerxioPublicNotepadShareResponse
} from '@/lib/verxio-api'
import { notify, notifyError } from '@/store/notifications'

import { useMicRecorder } from '../chat/composer/hooks/use-mic-recorder'
import { TITLEBAR_CLEARANCE_RIGHT, TITLEBAR_CLEARANCE_TOP } from '../layout-constants'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface NotepadViewProps {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

interface NoteDraft {
  title: string
  folder_id: string | null
  content: string
  summary: string
}

const NOTE_TIME = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short'
})

const ALL_FOLDER = '__all__'
const DEFAULT_FOLDER = '__default__'
const DEFAULT_FOLDER_LABEL = 'Default'
const NOTES_PER_PAGE = 10

const NOTEPAD_MIC_COPY = {
  microphoneAccessDenied: 'Microphone access was denied.',
  microphoneConstraintsUnsupported: 'This microphone does not support the requested recording settings.',
  microphoneInUse: 'The microphone is already in use.',
  microphonePermissionDenied: 'Microphone permission was denied.',
  microphoneStartFailed: 'Could not start recording.',
  microphoneUnsupported: 'Audio recording is not supported in this browser.',
  noMicrophone: 'No microphone was found.'
}

type RecordingMode = 'idle' | 'mic' | 'system' | 'transcribing'
type PendingDelete = { folder: VerxioNotepadFolder; kind: 'folder' } | { kind: 'note'; note: VerxioNotepadNote }

function noteTime(value: string) {
  const parsed = Date.parse(value)

  return Number.isFinite(parsed) ? NOTE_TIME.format(parsed) : ''
}

function noteBody(note: VerxioNotepadNote): string {
  return [note.content.trim(), note.transcript.trim()].filter(Boolean).join('\n\n')
}

function draftFromNote(note: VerxioNotepadNote): NoteDraft {
  return {
    title: note.title,
    folder_id: note.folder_id,
    content: noteBody(note),
    summary: note.summary
  }
}

function draftChanged(note: VerxioNotepadNote, draft: NoteDraft): boolean {
  return (
    note.title !== draft.title ||
    note.folder_id !== draft.folder_id ||
    noteBody(note) !== draft.content ||
    note.summary !== draft.summary
  )
}

function replaceNote(notes: VerxioNotepadNote[], note: VerxioNotepadNote): VerxioNotepadNote[] {
  const existing = notes.findIndex(item => item.id === note.id)

  if (existing === -1) {
    return [note, ...notes]
  }

  const next = [...notes]
  next[existing] = note

  return next.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
}

function publicShareBaseUrl(): string {
  const configured = import.meta.env.VITE_VERXIO_PUBLIC_WEB_URL?.replace(/\/$/, '')

  if (configured) {
    return configured
  }

  const apiBase = verxioApiBaseUrl()

  if (apiBase.includes(':8787')) {
    return apiBase.replace(':8787', ':8080')
  }

  return window.location.origin
}

function shareUrlFromToken(token: string | null): string {
  if (!token) {
    return ''
  }

  return `${publicShareBaseUrl()}/share/notepad/${token}`
}

export function NotepadView({ setStatusbarItemGroup }: NotepadViewProps) {
  const [folders, setFolders] = useState<VerxioNotepadFolder[]>([])
  const [notes, setNotes] = useState<VerxioNotepadNote[]>([])
  const [selectedFolder, setSelectedFolder] = useState(ALL_FOLDER)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [notePage, setNotePage] = useState(1)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [summaryEditing, setSummaryEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderNameError, setFolderNameError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('idle')
  const [recordingSeconds, setRecordingSeconds] = useState(0)

  const [systemAudioSupported, setSystemAudioSupported] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getDisplayMedia) &&
      (!isVerxioDesktop() || Boolean(window.hermesDesktop?.audio?.listCaptureSources))
  )

  const [capturePickerOpen, setCapturePickerOpen] = useState(false)
  const [captureSources, setCaptureSources] = useState<DesktopCaptureSource[]>([])
  const [selectedCaptureSourceId, setSelectedCaptureSourceId] = useState<string | null>(null)
  const [capturePickerLoading, setCapturePickerLoading] = useState(false)
  const { handle: micRecorder, level: micLevel } = useMicRecorder(NOTEPAD_MIC_COPY)
  const systemRecorderRef = useRef<MediaRecorder | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const systemChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const micRecorderRef = useRef(micRecorder)

  const folderById = useMemo(() => new Map(folders.map(folder => [folder.id, folder])), [folders])
  const trimmedQuery = query.trim().toLowerCase()

  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      const folderMatches =
        selectedFolder === ALL_FOLDER ||
        (selectedFolder === DEFAULT_FOLDER ? !note.folder_id : note.folder_id === selectedFolder)

      if (!folderMatches) {
        return false
      }

      if (!trimmedQuery) {
        return true
      }

      return [note.title, note.summary, noteBody(note), folderById.get(note.folder_id || '')?.name]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(trimmedQuery))
    })
  }, [folderById, notes, selectedFolder, trimmedQuery])

  const pageCount = Math.max(1, Math.ceil(filteredNotes.length / NOTES_PER_PAGE))
  const currentPage = Math.min(notePage, pageCount)
  const pageStart = (currentPage - 1) * NOTES_PER_PAGE
  const paginatedNotes = filteredNotes.slice(pageStart, pageStart + NOTES_PER_PAGE)

  const selectedNote = useMemo(
    () => paginatedNotes.find(note => note.id === selectedNoteId) ?? paginatedNotes[0] ?? null,
    [paginatedNotes, selectedNoteId]
  )

  const dirty = Boolean(selectedNote && draft && draftChanged(selectedNote, draft))

  const recordingLevel = recordingMode === 'mic' ? micLevel : recordingMode === 'system' ? 0.65 : 0

  const pendingDeleteBusy = pendingDelete
    ? pendingDelete.kind === 'note'
      ? busyAction === 'delete-note'
      : busyAction === pendingDelete.folder.id
    : false

  const pendingDeleteFolderName = pendingDelete?.kind === 'folder' ? pendingDelete.folder.name : ''

  const pendingDeleteNoteTitle =
    pendingDelete?.kind === 'note' ? pendingDelete.note.title.trim() || 'this note' : 'this note'

  const load = useCallback(async () => {
    setLoading(true)

    try {
      const response = await listNotepad()
      setFolders(response.folders)
      setNotes(response.notes)
      setSelectedNoteId(current => current ?? response.notes[0]?.id ?? null)
    } catch (error) {
      notifyError(error, 'Could not load notes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setNotePage(1)
  }, [selectedFolder, trimmedQuery])

  useEffect(() => {
    if (notePage > pageCount) {
      setNotePage(pageCount)
    }
  }, [notePage, pageCount])

  useEffect(() => {
    if (paginatedNotes.length === 0) {
      setSelectedNoteId(null)

      return
    }

    if (!selectedNoteId || !paginatedNotes.some(note => note.id === selectedNoteId)) {
      setSelectedNoteId(paginatedNotes[0].id)
    }
  }, [paginatedNotes, selectedNoteId])

  useEffect(() => {
    let cancelled = false

    window.hermesDesktop?.audio
      ?.captureSupport()
      .then(support => {
        if (!cancelled) {
          setSystemAudioSupported(Boolean(support.systemAudio))
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (recordingMode !== 'mic' && recordingMode !== 'system') {
      return
    }

    recordingStartedAtRef.current = Date.now()
    setRecordingSeconds(0)

    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
    }, 250)

    return () => window.clearInterval(timer)
  }, [recordingMode])

  useEffect(() => {
    micRecorderRef.current = micRecorder
  }, [micRecorder])

  useEffect(
    () => () => {
      micRecorderRef.current.cancel()
      systemRecorderRef.current?.stop()
      systemStreamRef.current?.getTracks().forEach(track => track.stop())
    },
    []
  )

  useEffect(() => {
    if (!selectedNote) {
      setDraft(null)

      return
    }

    setDraft(draftFromNote(selectedNote))
    setSummaryEditing(false)
  }, [selectedNote])

  useEffect(() => {
    setStatusbarItemGroup?.('notepad', [
      {
        id: 'notepad-count',
        label: `${notes.length} notes`
      }
    ])

    return () => setStatusbarItemGroup?.('notepad', [])
  }, [notes.length, setStatusbarItemGroup])

  async function handleNewNote() {
    setBusyAction('new-note')

    try {
      const folder_id = selectedFolder !== ALL_FOLDER && selectedFolder !== DEFAULT_FOLDER ? selectedFolder : null
      const note = await createNotepadNote({ folder_id, title: 'Untitled note' })
      setNotes(current => replaceNote(current, note))
      setSelectedNoteId(note.id)
    } catch (error) {
      notifyError(error, 'Could not create note')
    } finally {
      setBusyAction(null)
    }
  }

  function handleFolderDialogOpenChange(open: boolean) {
    if (busyAction === 'new-folder') {
      return
    }

    setFolderDialogOpen(open)

    if (open) {
      setFolderName('')
    } else {
      setFolderNameError(null)
    }
  }

  async function handleNewFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = folderName.trim()

    if (!name) {
      setFolderNameError('Enter a folder name.')

      return
    }

    setBusyAction('new-folder')

    try {
      const folder = await createNotepadFolder(name)
      setFolders(current => [...current, folder])
      setSelectedFolder(folder.id)
      setFolderDialogOpen(false)
      setFolderName('')
      setFolderNameError(null)
    } catch (error) {
      notifyError(error, 'Could not create folder')
    } finally {
      setBusyAction(null)
    }
  }

  function handleDeleteFolder(folder: VerxioNotepadFolder) {
    setPendingDelete({ folder, kind: 'folder' })
  }

  function handleDeleteDialogOpenChange(open: boolean) {
    if (pendingDeleteBusy) {
      return
    }

    if (!open) {
      setPendingDelete(null)
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return
    }

    if (pendingDelete.kind === 'folder') {
      const { folder } = pendingDelete

      setBusyAction(folder.id)

      try {
        await deleteNotepadFolder(folder.id)
        setFolders(current => current.filter(item => item.id !== folder.id))
        setNotes(current => current.map(note => (note.folder_id === folder.id ? { ...note, folder_id: null } : note)))
        setSelectedFolder(ALL_FOLDER)
        setPendingDelete(null)
      } catch (error) {
        notifyError(error, 'Could not delete folder')
      } finally {
        setBusyAction(null)
      }

      return
    }

    const { note: noteToDelete } = pendingDelete

    setBusyAction('delete-note')

    try {
      await deleteNotepadNote(noteToDelete.id)
      const remaining = notes.filter(note => note.id !== noteToDelete.id)
      setNotes(remaining)
      setSelectedNoteId(remaining[0]?.id ?? null)
      setPendingDelete(null)
    } catch (error) {
      notifyError(error, 'Could not delete note')
    } finally {
      setBusyAction(null)
    }
  }

  function payloadFromDraft(nextDraft: NoteDraft): VerxioNotepadNoteInput {
    return {
      title: nextDraft.title.trim() || 'Untitled note',
      folder_id: nextDraft.folder_id,
      content: nextDraft.content,
      transcript: '',
      summary: nextDraft.summary,
      meeting_type: selectedNote?.meeting_type || 'general'
    }
  }

  async function persistDraft(nextDraft: NoteDraft, successMessage?: string) {
    if (!selectedNote) {
      return null
    }

    try {
      const note = await updateNotepadNote(selectedNote.id, payloadFromDraft(nextDraft))
      setNotes(current => replaceNote(current, note))

      if (successMessage) {
        notify({ kind: 'success', message: successMessage })
      }

      return note
    } catch (error) {
      notifyError(error, 'Could not save note')

      return null
    }
  }

  async function handleSave() {
    if (!selectedNote || !draft || !dirty) {
      return
    }

    setSaving(true)

    try {
      await persistDraft(draft, 'Note saved')
    } finally {
      setSaving(false)
    }
  }

  function cleanupSystemRecording() {
    systemStreamRef.current?.getTracks().forEach(track => track.stop())
    systemStreamRef.current = null
    systemRecorderRef.current = null
    systemChunksRef.current = []
  }

  async function startSystemRecording() {
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Device audio capture is not available in this environment.')
    }

    const capture = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true
    })

    const audioTracks = capture.getAudioTracks()

    if (!audioTracks.length) {
      capture.getTracks().forEach(track => track.stop())
      throw new Error(
        isVerxioDesktop()
          ? 'No system audio track was available for the selected source. Try another screen or window, or use microphone recording.'
          : 'No audio was shared. Select a screen or window and enable audio sharing in the browser dialog, or use microphone recording.'
      )
    }

    capture.getVideoTracks().forEach(track => track.stop())
    const stream = new MediaStream(audioTracks)

    const mimeType =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'].find(type =>
        MediaRecorder.isTypeSupported(type)
      ) ?? ''

    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: NOTEPAD_RECORDING_BITS_PER_SECOND
    })

    systemChunksRef.current = []
    systemStreamRef.current = stream
    systemRecorderRef.current = recorder

    recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        systemChunksRef.current.push(event.data)
      }
    }

    recorder.start(1000)
    setRecordingMode('system')
  }

  function stopSystemRecording(): Promise<Blob | null> {
    return new Promise(resolve => {
      const recorder = systemRecorderRef.current

      if (!recorder || recorder.state === 'inactive') {
        cleanupSystemRecording()
        resolve(null)

        return
      }

      recorder.onstop = () => {
        const chunks = systemChunksRef.current
        const type = recorder.mimeType || 'audio/webm'
        cleanupSystemRecording()
        resolve(chunks.length ? new Blob(chunks, { type }) : null)
      }

      recorder.stop()
    })
  }

  async function persistTranscript(transcript: string, source: 'desktop-audio' | 'microphone') {
    if (!selectedNote || !draft) {
      return
    }

    const stamp = NOTE_TIME.format(new Date())
    const heading = source === 'desktop-audio' ? 'Device recording' : 'Mic recording'
    const block = `### ${heading} - ${stamp}\n\n${transcript}`

    const nextDraft = {
      ...draft,
      content: [draft.content.trim(), block].filter(Boolean).join('\n\n')
    }

    setDraft(nextDraft)

    const note = await updateNotepadNote(selectedNote.id, {
      ...payloadFromDraft(nextDraft),
      source
    })

    setNotes(current => replaceNote(current, note))
    notify({ kind: 'success', message: 'Transcript added' })
  }

  async function transcribeRecording(audio: Blob | null, source: 'desktop-audio' | 'microphone') {
    if (!audio || audio.size === 0) {
      notify({ kind: 'warning', message: 'Recording was empty. Try again and speak or play audio before stopping.' })
      setRecordingMode('idle')

      return
    }

    setRecordingMode('transcribing')

    try {
      const transcript = (await transcribeAudioBlob(audio)).trim()

      if (!transcript) {
        notify({ kind: 'warning', message: 'No speech detected' })
      } else {
        await persistTranscript(transcript, source)
      }
    } catch (error) {
      notifyError(error, 'Could not transcribe recording')
    } finally {
      setRecordingMode('idle')
    }
  }

  async function handleStartSystemRecording() {
    if (!selectedNote || !draft) {
      return
    }

    if (isVerxioDesktop()) {
      setCapturePickerLoading(true)
      setCapturePickerOpen(true)
      setSelectedCaptureSourceId(null)

      try {
        const sources = (await window.hermesDesktop?.audio?.listCaptureSources?.()) ?? []
        setCaptureSources(sources)

        if (!sources.length) {
          setCapturePickerOpen(false)
          notifyError(
            new Error('No screens or windows are available to record.'),
            'Could not start device audio recording'
          )
        }
      } catch (error) {
        setCapturePickerOpen(false)
        notifyError(error, 'Could not start device audio recording')
      } finally {
        setCapturePickerLoading(false)
      }

      return
    }

    try {
      await startSystemRecording()
    } catch (error) {
      notifyError(error, 'Could not start device audio recording')
      setRecordingMode('idle')
    }
  }

  async function handleConfirmCaptureSource() {
    if (!selectedCaptureSourceId) {
      return
    }

    setCapturePickerOpen(false)

    try {
      const prepared = await window.hermesDesktop?.audio?.prepareCaptureSource?.(selectedCaptureSourceId)

      if (!prepared?.ok) {
        throw new Error('Could not prepare the selected capture source.')
      }

      await startSystemRecording()
    } catch (error) {
      notifyError(error, 'Could not start device audio recording')
      setRecordingMode('idle')
    }
  }

  function handleCapturePickerOpenChange(open: boolean) {
    setCapturePickerOpen(open)

    if (!open) {
      setCaptureSources([])
      setSelectedCaptureSourceId(null)
      setCapturePickerLoading(false)
    }
  }

  async function handleStartMicRecording() {
    if (!selectedNote || !draft) {
      return
    }

    try {
      await micRecorder.start({ audioBitsPerSecond: NOTEPAD_RECORDING_BITS_PER_SECOND })
      setRecordingMode('mic')
    } catch (error) {
      notifyError(error, 'Could not start microphone recording')
      setRecordingMode('idle')
    }
  }

  async function handleStopRecording() {
    if (recordingMode === 'system') {
      await transcribeRecording(await stopSystemRecording(), 'desktop-audio')

      return
    }

    if (recordingMode === 'mic') {
      const result = await micRecorder.stop()
      await transcribeRecording(result?.audio ?? null, 'microphone')
    }
  }

  async function handleGenerateSummary() {
    if (!selectedNote) {
      return
    }

    setBusyAction('summarize-note')

    try {
      if (dirty && draft) {
        await persistDraft(draft)
      }

      const note = await summarizeNotepadNote(selectedNote.id)
      setNotes(current => replaceNote(current, note))
      setDraft(draftFromNote(note))
      setSummaryEditing(false)
      notify({ kind: 'success', message: 'Summary generated' })
    } catch (error) {
      notifyError(error, 'Could not generate summary')
    } finally {
      setBusyAction(null)
    }
  }

  function handleDeleteNote() {
    if (!selectedNote) {
      return
    }

    setPendingDelete({ kind: 'note', note: selectedNote })
  }

  async function handleShare() {
    if (!selectedNote) {
      return
    }

    setBusyAction('share-note')

    try {
      const share = await shareNotepadNote(selectedNote.id)
      setNotes(current => replaceNote(current, share.note))
      await navigator.clipboard?.writeText(shareUrlFromToken(share.token))
      notify({ kind: 'success', message: 'Share URL copied' })
    } catch (error) {
      notifyError(error, 'Could not share note')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCopyShareUrl() {
    if (!selectedNote?.share_token) {
      return
    }

    await navigator.clipboard?.writeText(shareUrlFromToken(selectedNote.share_token))
    notify({ kind: 'success', message: 'Share URL copied' })
  }

  async function handleRevokeShare() {
    if (!selectedNote) {
      return
    }

    setBusyAction('revoke-share')

    try {
      await revokeNotepadShare(selectedNote.id)
      setNotes(current =>
        replaceNote(current, {
          ...selectedNote,
          share_token: null
        })
      )
      notify({ kind: 'success', message: 'Share URL revoked' })
    } catch (error) {
      notifyError(error, 'Could not revoke share')
    } finally {
      setBusyAction(null)
    }
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-background text-foreground">
        <PageLoader label="Loading notes" />
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground lg:flex-row',
          TITLEBAR_CLEARANCE_TOP
        )}
      >
        <aside className="flex min-w-0 max-h-40 w-full shrink-0 flex-col overflow-hidden border-b border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) lg:h-full lg:max-h-none lg:w-48 lg:border-b-0 lg:border-r">
          <div
            className={cn(
              'flex h-12 min-w-0 items-center justify-between gap-2 border-b border-(--ui-stroke-secondary) px-3',
              TITLEBAR_CLEARANCE_RIGHT,
              'lg:pr-3'
            )}
          >
            <h1 className="min-w-0 truncate text-sm font-semibold tracking-normal">Notepad</h1>
            <div className="flex shrink-0 items-center gap-1">
              <Tip label="New folder">
                <Button
                  aria-label="New folder"
                  disabled={busyAction === 'new-folder'}
                  onClick={() => handleFolderDialogOpenChange(true)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="new-folder" />
                </Button>
              </Tip>
              <Tip label="New note">
                <Button
                  aria-label="New note"
                  disabled={busyAction === 'new-note'}
                  onClick={handleNewNote}
                  size="icon-xs"
                  type="button"
                  variant="secondary"
                >
                  <Codicon name="add" />
                </Button>
              </Tip>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            <FolderButton
              active={selectedFolder === ALL_FOLDER}
              count={notes.length}
              icon="notebook"
              label="All notes"
              onClick={() => setSelectedFolder(ALL_FOLDER)}
            />
            <FolderButton
              active={selectedFolder === DEFAULT_FOLDER}
              count={notes.filter(note => !note.folder_id).length}
              icon="folder"
              label={DEFAULT_FOLDER_LABEL}
              onClick={() => setSelectedFolder(DEFAULT_FOLDER)}
            />

            <div className="mt-3 space-y-1">
              {folders.map(folder => (
                <div className="group flex items-center gap-1" key={folder.id}>
                  <FolderButton
                    active={selectedFolder === folder.id}
                    count={notes.filter(note => note.folder_id === folder.id).length}
                    icon="folder"
                    label={folder.name}
                    onClick={() => setSelectedFolder(folder.id)}
                  />
                  <Tip label="Delete folder">
                    <Button
                      aria-label={`Delete ${folder.name}`}
                      className="opacity-0 group-hover:opacity-100"
                      disabled={busyAction === folder.id}
                      onClick={() => handleDeleteFolder(folder)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Codicon name="trash" />
                    </Button>
                  </Tip>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex h-80 min-w-0 w-full shrink-0 flex-col overflow-hidden border-b border-(--ui-stroke-secondary) sm:h-[22rem] lg:h-full lg:w-[22rem] lg:border-b-0 lg:border-r">
          <div className="flex h-12 items-center gap-2 border-b border-(--ui-stroke-secondary) px-3">
            <div className="relative min-w-0 flex-1">
              <Codicon
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                name="search"
              />
              <input
                className="h-8 w-full rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) pl-7 pr-2 text-sm outline-none focus:border-ring"
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => event.stopPropagation()}
                placeholder="Search notes"
                type="search"
                value={query}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {filteredNotes.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted-foreground">No notes found.</div>
            ) : (
              paginatedNotes.map(note => (
                <button
                  className={cn(
                    'block w-full border-b border-(--ui-stroke-secondary) px-3 py-3 text-left hover:bg-(--ui-control-hover-background)',
                    selectedNote?.id === note.id && 'bg-(--ui-control-active-background)'
                  )}
                  key={note.id}
                  onClick={() => setSelectedNoteId(note.id)}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{note.title}</span>
                    {note.share_token && <Codicon className="text-muted-foreground" name="link" />}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {folderById.get(note.folder_id || '')?.name || DEFAULT_FOLDER_LABEL}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{noteTime(note.updated_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {note.summary || noteBody(note) || 'Empty note'}
                  </p>
                </button>
              ))
            )}
          </div>

          <div className="flex h-11 shrink-0 items-center justify-between border-t border-(--ui-stroke-secondary) px-3 text-xs text-muted-foreground">
            <span>
              {filteredNotes.length
                ? `${pageStart + 1}-${Math.min(pageStart + NOTES_PER_PAGE, filteredNotes.length)} of ${
                    filteredNotes.length
                  }`
                : '0 notes'}
            </span>
            <div className="flex items-center gap-1">
              <Tip label="Previous page">
                <Button
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() => setNotePage(page => Math.max(1, page - 1))}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="chevron-left" />
                </Button>
              </Tip>
              <span className="min-w-10 text-center">
                {currentPage}/{pageCount}
              </span>
              <Tip label="Next page">
                <Button
                  aria-label="Next page"
                  disabled={currentPage >= pageCount}
                  onClick={() => setNotePage(page => Math.min(pageCount, page + 1))}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="chevron-right" />
                </Button>
              </Tip>
            </div>
          </div>
        </section>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {selectedNote && draft ? (
            <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
              <div
                className={cn(
                  'flex min-h-12 shrink-0 min-w-0 max-w-full flex-wrap items-center gap-2 overflow-x-hidden border-b border-(--ui-stroke-secondary) bg-background/95 px-3 py-2 backdrop-blur sm:px-4',
                  TITLEBAR_CLEARANCE_RIGHT
                )}
              >
                <input
                  className="h-9 min-w-0 flex-1 basis-full bg-transparent text-lg font-semibold tracking-normal outline-none sm:basis-72"
                  onChange={event =>
                    setDraft(current => (current ? { ...current, title: event.target.value } : current))
                  }
                  value={draft.title}
                />
                <select
                  className="h-8 min-w-0 flex-1 rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 text-xs outline-none sm:flex-none"
                  onChange={event =>
                    setDraft(current => (current ? { ...current, folder_id: event.target.value || null } : current))
                  }
                  value={draft.folder_id ?? ''}
                >
                  <option value="">{DEFAULT_FOLDER_LABEL}</option>
                  {folders.map(folder => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                <Button disabled={!dirty || saving} onClick={handleSave} size="sm" type="button" variant="secondary">
                  <Codicon name={saving ? 'loading' : 'save'} spinning={saving} />
                  Save
                </Button>
                {recordingMode === 'idle' ? (
                  <>
                    {systemAudioSupported && (
                      <Tip label="Record device audio from a screen or window">
                        <Button onClick={handleStartSystemRecording} size="sm" type="button" variant="secondary">
                          <Codicon name="record" />
                          Device
                        </Button>
                      </Tip>
                    )}
                    <Tip label="Record microphone">
                      <Button
                        aria-label="Record microphone"
                        onClick={handleStartMicRecording}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Codicon name="mic" />
                      </Button>
                    </Tip>
                  </>
                ) : recordingMode === 'transcribing' ? (
                  <Button disabled size="sm" type="button" variant="secondary">
                    <Codicon name="loading" spinning />
                    Transcribing
                  </Button>
                ) : (
                  <Button onClick={handleStopRecording} size="sm" type="button" variant="destructive">
                    <Codicon name="debug-stop" />
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-current opacity-80"
                      style={{ transform: `scale(${0.75 + recordingLevel * 0.7})` }}
                    />
                    {recordingMode === 'system' ? 'Device' : 'Mic'} {recordingSeconds}s
                  </Button>
                )}
                <Button
                  disabled={busyAction === 'summarize-note' || !draft.content.trim()}
                  onClick={handleGenerateSummary}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Codicon
                    name={busyAction === 'summarize-note' ? 'loading' : 'sparkle'}
                    spinning={busyAction === 'summarize-note'}
                  />
                  Summary
                </Button>
                {selectedNote.share_token ? (
                  <>
                    <Tip label="Copy public URL">
                      <Button
                        aria-label="Copy public URL"
                        onClick={handleCopyShareUrl}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Codicon name="link" />
                      </Button>
                    </Tip>
                    <Tip label="Revoke public URL">
                      <Button
                        aria-label="Revoke public URL"
                        disabled={busyAction === 'revoke-share'}
                        onClick={handleRevokeShare}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Codicon name="link-external" />
                      </Button>
                    </Tip>
                  </>
                ) : (
                  <Tip label="Create public URL">
                    <Button
                      aria-label="Create public URL"
                      disabled={busyAction === 'share-note'}
                      onClick={handleShare}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Codicon name="link" />
                    </Button>
                  </Tip>
                )}
                <Tip label="Delete note">
                  <Button
                    aria-label="Delete note"
                    disabled={busyAction === 'delete-note'}
                    onClick={handleDeleteNote}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Codicon name="trash" />
                  </Button>
                </Tip>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] xl:grid-rows-1">
                <section className="flex min-h-0 flex-col border-b border-(--ui-stroke-secondary) p-3 sm:p-4 xl:border-b-0 xl:border-r">
                  <label className="shrink-0 text-xs font-medium text-muted-foreground" htmlFor="notepad-notes">
                    Notes
                  </label>
                  <textarea
                    className="mt-2 min-h-0 flex-1 w-full resize-none overflow-auto rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-sm leading-6 outline-none focus:border-ring"
                    id="notepad-notes"
                    onChange={event =>
                      setDraft(current => (current ? { ...current, content: event.target.value } : current))
                    }
                    value={draft.content}
                  />
                </section>

                <section className="flex min-h-0 flex-col p-3 sm:p-4">
                  <div className="flex shrink-0 items-center justify-between gap-2">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="notepad-summary">
                      Summary
                    </label>
                    <Button
                      onClick={() => setSummaryEditing(current => !current)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Codicon name={summaryEditing ? 'eye' : 'edit'} />
                      {summaryEditing ? 'Preview' : 'Edit'}
                    </Button>
                  </div>

                  {summaryEditing ? (
                    <textarea
                      className="mt-2 min-h-0 flex-1 w-full resize-none overflow-auto rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-sm leading-6 outline-none focus:border-ring"
                      id="notepad-summary"
                      onChange={event =>
                        setDraft(current => (current ? { ...current, summary: event.target.value } : current))
                      }
                      value={draft.summary}
                    />
                  ) : draft.summary.trim() ? (
                    <div
                      aria-label="Formatted summary"
                      className="mt-2 min-h-0 flex-1 overflow-auto rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4"
                    >
                      <NotepadMarkdown text={draft.summary} />
                    </div>
                  ) : (
                    <div className="mt-2 grid min-h-0 flex-1 place-items-center rounded-[4px] border border-dashed border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 text-center text-sm text-muted-foreground">
                      Generate a summary to view it here.
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">
              <Button onClick={handleNewNote} type="button" variant="secondary">
                <Codicon name="add" />
                Create note
              </Button>
            </div>
          )}
        </main>
      </div>

      <Dialog onOpenChange={handleFolderDialogOpenChange} open={folderDialogOpen}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription className="sr-only">Enter a name for the new Notepad folder.</DialogDescription>
          </DialogHeader>

          <form aria-busy={busyAction === 'new-folder'} className="grid gap-3" onSubmit={handleNewFolder}>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="notepad-folder-name">
                Folder name
              </label>
              <Input
                aria-describedby={folderNameError ? 'notepad-folder-name-error' : undefined}
                aria-invalid={folderNameError ? 'true' : undefined}
                autoComplete="off"
                autoFocus
                disabled={busyAction === 'new-folder'}
                id="notepad-folder-name"
                maxLength={120}
                onChange={event => {
                  setFolderName(event.target.value)
                  setFolderNameError(null)
                }}
                placeholder="Investor calls"
                spellCheck
                type="text"
                value={folderName}
              />
              {folderNameError ? (
                <p className="text-xs text-destructive" id="notepad-folder-name-error">
                  {folderNameError}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                disabled={busyAction === 'new-folder'}
                onClick={() => handleFolderDialogOpenChange(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={busyAction === 'new-folder'} type="submit">
                {busyAction === 'new-folder' ? <Codicon name="loading" spinning /> : <Codicon name="new-folder" />}
                Create folder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={handleDeleteDialogOpenChange} open={Boolean(pendingDelete)}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{pendingDelete?.kind === 'folder' ? 'Delete folder' : 'Delete note'}</DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === 'folder' ? (
                <>
                  Notes in <span className="font-medium text-foreground">{pendingDeleteFolderName}</span> move to{' '}
                  {DEFAULT_FOLDER_LABEL}.
                </>
              ) : (
                <>
                  This deletes <span className="font-medium text-foreground">{pendingDeleteNoteTitle}</span>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              disabled={pendingDeleteBusy}
              onClick={() => handleDeleteDialogOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={pendingDeleteBusy} onClick={handleConfirmDelete} type="button" variant="destructive">
              {pendingDeleteBusy ? <Codicon name="loading" spinning /> : <Codicon name="trash" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={handleCapturePickerOpenChange} open={capturePickerOpen}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Choose what to record</DialogTitle>
            <DialogDescription>
              Select a screen or window. Verxio records system audio from your device while the meeting plays.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {capturePickerLoading ? (
              <div className="text-dt-muted flex items-center gap-2 px-1 py-2 text-sm">
                <Codicon name="loading" spinning />
                Loading screens and windows…
              </div>
            ) : captureSources.length ? (
              captureSources.map(source => {
                const selected = selectedCaptureSourceId === source.id

                return (
                  <button
                    className={cn(
                      'border-dt-border hover:bg-dt-muted/40 flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      selected && 'border-dt-primary bg-dt-primary/10'
                    )}
                    key={source.id}
                    onClick={() => setSelectedCaptureSourceId(source.id)}
                    type="button"
                  >
                    <Codicon name={source.type === 'screen' ? 'device-desktop' : 'window'} />
                    <span className="truncate">{source.name}</span>
                  </button>
                )
              })
            ) : (
              <p className="text-dt-muted px-1 py-2 text-sm">No screens or windows are available.</p>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => handleCapturePickerOpenChange(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={!selectedCaptureSourceId || capturePickerLoading}
              onClick={() => void handleConfirmCaptureSource()}
              type="button"
              variant="secondary"
            >
              Start recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FolderButton({
  active,
  count,
  icon,
  label,
  onClick
}: {
  active: boolean
  count: number
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[4px] px-2 text-left text-sm text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
        active && 'bg-(--ui-control-active-background) text-foreground'
      )}
      onClick={onClick}
      type="button"
    >
      <Codicon className="shrink-0" name={icon} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
    </button>
  )
}

function NotepadMarkdown({ text }: { text: string }) {
  return (
    <CompactMarkdown
      className="text-sm text-foreground/90 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:first:mt-0 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:first:mt-0 [&_li]:my-1 [&_p]:mb-3 [&_ul]:mb-4"
      text={text}
    />
  )
}

const VERXIO_WEBSITE_URL = 'https://www.verxio.xyz'

function PoweredByVerxioFooter() {
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
          style={{ '--fit-text-line-height': '0.9', '--fit-text-min': '0.78rem' } as React.CSSProperties}
          variant="solid"
        />
      </a>
    </footer>
  )
}

export function PublicNotepadShareView() {
  const [payload, setPayload] = useState<VerxioPublicNotepadShareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '')

  useEffect(() => {
    let cancelled = false

    getPublicNotepadShare(token)
      .then(response => {
        if (!cancelled) {
          setPayload(response)
        }
      })
      .catch(fetchError => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Shared note not found')
        }
      })

    return () => {
      cancelled = true
    }
  }, [token])

  if (error) {
    return (
      <>
        <main className="grid min-h-dvh place-items-center bg-background px-4 pb-14 text-foreground">
          <section className="w-full max-w-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-5">
            <h1 className="text-base font-semibold tracking-normal">Shared note unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </section>
        </main>
        <PoweredByVerxioFooter />
      </>
    )
  }

  if (!payload) {
    return (
      <>
        <div className="grid min-h-dvh place-items-center bg-background pb-14 text-foreground">
          <PageLoader label="Loading shared note" />
        </div>
        <PoweredByVerxioFooter />
      </>
    )
  }

  const note = payload.note
  const summary = note.summary.trim()

  return (
    <>
      <main className="h-dvh overflow-y-auto bg-background pb-14 text-foreground">
        <article className="mx-auto max-w-4xl px-5 py-8">
          <div className="border-b border-(--ui-stroke-secondary) pb-5">
            <p className="text-xs font-medium text-muted-foreground">{payload.workspace_name}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">{note.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{payload.folder?.name || 'Shared summary'}</span>
              <span aria-hidden="true">·</span>
              <span>{noteTime(note.updated_at)}</span>
            </div>
          </div>

          {summary ? (
            <section className="py-6">
              <h2 className="sr-only">Summary</h2>
              <NotepadMarkdown text={summary} />
            </section>
          ) : (
            <section className="grid min-h-64 place-items-center py-8 text-center text-sm text-muted-foreground">
              This shared note does not have a summary yet.
            </section>
          )}
        </article>
      </main>
      <PoweredByVerxioFooter />
    </>
  )
}
