import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { transcribeAudioBlob } from '@/lib/audio'
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
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface NotepadViewProps {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

interface NoteDraft {
  title: string
  folder_id: string | null
  content: string
  transcript: string
  summary: string
  meeting_type: string
}

const NOTE_TIME = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short'
})

const ALL_FOLDER = '__all__'
const UNFILED_FOLDER = '__unfiled__'

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

function noteTime(value: string) {
  const parsed = Date.parse(value)

  return Number.isFinite(parsed) ? NOTE_TIME.format(parsed) : ''
}

function draftFromNote(note: VerxioNotepadNote): NoteDraft {
  return {
    title: note.title,
    folder_id: note.folder_id,
    content: note.content,
    transcript: note.transcript,
    summary: note.summary,
    meeting_type: note.meeting_type || 'general'
  }
}

function draftChanged(note: VerxioNotepadNote, draft: NoteDraft): boolean {
  return (
    note.title !== draft.title ||
    note.folder_id !== draft.folder_id ||
    note.content !== draft.content ||
    note.transcript !== draft.transcript ||
    note.summary !== draft.summary ||
    note.meeting_type !== draft.meeting_type
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

function shareUrlFromToken(token: string | null): string {
  if (!token) {
    return ''
  }

  const base = verxioApiBaseUrl() || window.location.origin

  return `${base}/share/notepad/${token}`
}

export function NotepadView({ setStatusbarItemGroup }: NotepadViewProps) {
  const [folders, setFolders] = useState<VerxioNotepadFolder[]>([])
  const [notes, setNotes] = useState<VerxioNotepadNote[]>([])
  const [selectedFolder, setSelectedFolder] = useState(ALL_FOLDER)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('idle')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [systemAudioSupported, setSystemAudioSupported] = useState(Boolean(window.hermesDesktop))
  const { handle: micRecorder, level: micLevel } = useMicRecorder(NOTEPAD_MIC_COPY)
  const systemRecorderRef = useRef<MediaRecorder | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const systemChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const micRecorderRef = useRef(micRecorder)

  const selectedNote = useMemo(
    () => notes.find(note => note.id === selectedNoteId) ?? notes[0] ?? null,
    [notes, selectedNoteId]
  )

  const folderById = useMemo(() => new Map(folders.map(folder => [folder.id, folder])), [folders])
  const trimmedQuery = query.trim().toLowerCase()

  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      const folderMatches =
        selectedFolder === ALL_FOLDER ||
        (selectedFolder === UNFILED_FOLDER ? !note.folder_id : note.folder_id === selectedFolder)

      if (!folderMatches) {
        return false
      }

      if (!trimmedQuery) {
        return true
      }

      return [note.title, note.summary, note.content, note.transcript, folderById.get(note.folder_id || '')?.name]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(trimmedQuery))
    })
  }, [folderById, notes, selectedFolder, trimmedQuery])

  const dirty = Boolean(selectedNote && draft && draftChanged(selectedNote, draft))
  const recordingLevel = recordingMode === 'mic' ? micLevel : recordingMode === 'system' ? 0.65 : 0

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
      const folder_id = selectedFolder !== ALL_FOLDER && selectedFolder !== UNFILED_FOLDER ? selectedFolder : null
      const note = await createNotepadNote({ folder_id, title: 'Untitled note' })
      setNotes(current => replaceNote(current, note))
      setSelectedNoteId(note.id)
    } catch (error) {
      notifyError(error, 'Could not create note')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleNewFolder() {
    const name = window.prompt('Folder name')

    if (!name?.trim()) {
      return
    }

    setBusyAction('new-folder')

    try {
      const folder = await createNotepadFolder(name.trim())
      setFolders(current => [...current, folder])
      setSelectedFolder(folder.id)
    } catch (error) {
      notifyError(error, 'Could not create folder')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDeleteFolder(folder: VerxioNotepadFolder) {
    if (!window.confirm(`Delete "${folder.name}"? Notes stay in Unfiled.`)) {
      return
    }

    setBusyAction(folder.id)

    try {
      await deleteNotepadFolder(folder.id)
      setFolders(current => current.filter(item => item.id !== folder.id))
      setNotes(current => current.map(note => (note.folder_id === folder.id ? { ...note, folder_id: null } : note)))
      setSelectedFolder(ALL_FOLDER)
    } catch (error) {
      notifyError(error, 'Could not delete folder')
    } finally {
      setBusyAction(null)
    }
  }

  function payloadFromDraft(nextDraft: NoteDraft): VerxioNotepadNoteInput {
    return {
      title: nextDraft.title.trim() || 'Untitled note',
      folder_id: nextDraft.folder_id,
      content: nextDraft.content,
      transcript: nextDraft.transcript,
      summary: nextDraft.summary,
      meeting_type: nextDraft.meeting_type || 'general'
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
      throw new Error('No device audio track was provided. Use microphone recording for this meeting.')
    }

    capture.getVideoTracks().forEach(track => track.stop())
    const stream = new MediaStream(audioTracks)

    const mimeType =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'].find(type =>
        MediaRecorder.isTypeSupported(type)
      ) ?? ''

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

    systemChunksRef.current = []
    systemStreamRef.current = stream
    systemRecorderRef.current = recorder

    recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        systemChunksRef.current.push(event.data)
      }
    }

    recorder.start()
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
    const block = `[${stamp}] ${transcript}`

    const nextDraft = {
      ...draft,
      transcript: [draft.transcript.trim(), block].filter(Boolean).join('\n\n')
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
    if (!audio) {
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

    try {
      await startSystemRecording()
    } catch (error) {
      notifyError(error, 'Could not start device audio recording')
      setRecordingMode('idle')
    }
  }

  async function handleStartMicRecording() {
    if (!selectedNote || !draft) {
      return
    }

    try {
      await micRecorder.start()
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
      notify({ kind: 'success', message: 'Summary generated' })
    } catch (error) {
      notifyError(error, 'Could not generate summary')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDeleteNote() {
    if (!selectedNote || !window.confirm(`Delete "${selectedNote.title}"?`)) {
      return
    }

    setBusyAction('delete-note')

    try {
      await deleteNotepadNote(selectedNote.id)
      const remaining = notes.filter(note => note.id !== selectedNote.id)
      setNotes(remaining)
      setSelectedNoteId(remaining[0]?.id ?? null)
    } catch (error) {
      notifyError(error, 'Could not delete note')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleShare() {
    if (!selectedNote) {
      return
    }

    setBusyAction('share-note')

    try {
      const share = await shareNotepadNote(selectedNote.id)
      setNotes(current => replaceNote(current, share.note))
      await navigator.clipboard?.writeText(share.url)
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
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <aside className="flex w-[15rem] shrink-0 flex-col border-r border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background)">
        <div className="flex h-12 items-center justify-between border-b border-(--ui-stroke-secondary) px-3">
          <h1 className="text-sm font-semibold tracking-normal">Notepad</h1>
          <div className="flex items-center gap-1">
            <Tip label="New folder">
              <Button
                aria-label="New folder"
                disabled={busyAction === 'new-folder'}
                onClick={handleNewFolder}
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
            active={selectedFolder === UNFILED_FOLDER}
            count={notes.filter(note => !note.folder_id).length}
            icon="folder"
            label="Unfiled"
            onClick={() => setSelectedFolder(UNFILED_FOLDER)}
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

      <section className="flex w-[22rem] shrink-0 flex-col border-r border-(--ui-stroke-secondary)">
        <div className="flex h-12 items-center gap-2 border-b border-(--ui-stroke-secondary) px-3">
          <div className="relative min-w-0 flex-1">
            <Codicon
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              name="search"
            />
            <input
              className="h-8 w-full rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) pl-7 pr-2 text-sm outline-none focus:border-ring"
              onChange={event => setQuery(event.target.value)}
              placeholder="Search notes"
              value={query}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {filteredNotes.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">No notes found.</div>
          ) : (
            filteredNotes.map(note => (
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
                  <span className="truncate">{folderById.get(note.folder_id || '')?.name || 'Unfiled'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{noteTime(note.updated_at)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {note.summary || note.content || note.transcript || 'Empty note'}
                </p>
              </button>
            ))
          )}
        </div>
      </section>

      <main className="min-w-0 flex-1 overflow-auto">
        {selectedNote && draft ? (
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
            <div className="sticky top-0 z-10 flex min-h-12 items-center gap-2 border-b border-(--ui-stroke-secondary) bg-background/95 px-4 backdrop-blur">
              <input
                className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-normal outline-none"
                onChange={event => setDraft(current => (current ? { ...current, title: event.target.value } : current))}
                value={draft.title}
              />
              <select
                className="h-8 rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 text-xs outline-none"
                onChange={event =>
                  setDraft(current => (current ? { ...current, folder_id: event.target.value || null } : current))
                }
                value={draft.folder_id ?? ''}
              >
                <option value="">Unfiled</option>
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
                    <Button onClick={handleStartSystemRecording} size="sm" type="button" variant="secondary">
                      <Codicon name="record" />
                      Device
                    </Button>
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
                disabled={busyAction === 'summarize-note' || (!draft.transcript.trim() && !draft.content.trim())}
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

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)] gap-0">
              <section className="border-r border-(--ui-stroke-secondary) p-4">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="notepad-summary">
                  Summary
                </label>
                <textarea
                  className="mt-2 min-h-28 w-full resize-y rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-sm leading-6 outline-none focus:border-ring"
                  id="notepad-summary"
                  onChange={event =>
                    setDraft(current => (current ? { ...current, summary: event.target.value } : current))
                  }
                  value={draft.summary}
                />

                <label className="mt-5 block text-xs font-medium text-muted-foreground" htmlFor="notepad-notes">
                  Notes
                </label>
                <textarea
                  className="mt-2 min-h-[26rem] w-full resize-y rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-sm leading-6 outline-none focus:border-ring"
                  id="notepad-notes"
                  onChange={event =>
                    setDraft(current => (current ? { ...current, content: event.target.value } : current))
                  }
                  value={draft.content}
                />
              </section>

              <section className="p-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="notepad-meeting-type">
                    Type
                  </label>
                  <input
                    className="h-8 min-w-0 flex-1 rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 text-sm outline-none focus:border-ring"
                    id="notepad-meeting-type"
                    onChange={event =>
                      setDraft(current => (current ? { ...current, meeting_type: event.target.value } : current))
                    }
                    value={draft.meeting_type}
                  />
                </div>

                <label className="mt-5 block text-xs font-medium text-muted-foreground" htmlFor="notepad-transcript">
                  Transcript
                </label>
                <textarea
                  className="mt-2 min-h-[34rem] w-full resize-y rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 font-mono text-xs leading-5 outline-none focus:border-ring"
                  id="notepad-transcript"
                  onChange={event =>
                    setDraft(current => (current ? { ...current, transcript: event.target.value } : current))
                  }
                  value={draft.transcript}
                />
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
      <main className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
        <section className="w-full max-w-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) p-5">
          <h1 className="text-base font-semibold tracking-normal">Shared note unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </section>
      </main>
    )
  }

  if (!payload) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        <PageLoader label="Loading shared note" />
      </div>
    )
  }

  const note = payload.note

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <article className="mx-auto max-w-4xl px-5 py-8">
        <div className="border-b border-(--ui-stroke-secondary) pb-5">
          <p className="text-xs font-medium text-muted-foreground">{payload.workspace_name}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">{note.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{payload.folder?.name || 'Shared note'}</span>
            <span aria-hidden="true">·</span>
            <span>{note.meeting_type}</span>
            <span aria-hidden="true">·</span>
            <span>{noteTime(note.updated_at)}</span>
          </div>
        </div>

        {note.summary && (
          <section className="border-b border-(--ui-stroke-secondary) py-5">
            <h2 className="text-sm font-semibold tracking-normal">Summary</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{note.summary}</p>
          </section>
        )}

        {note.content && (
          <section className="border-b border-(--ui-stroke-secondary) py-5">
            <h2 className="text-sm font-semibold tracking-normal">Notes</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{note.content}</p>
          </section>
        )}

        {note.transcript && (
          <section className="py-5">
            <h2 className="text-sm font-semibold tracking-normal">Transcript</h2>
            <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-5 text-muted-foreground">
              {note.transcript}
            </pre>
          </section>
        )}
      </article>
    </main>
  )
}
