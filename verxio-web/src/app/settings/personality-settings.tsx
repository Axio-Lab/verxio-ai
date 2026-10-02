import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { sessionRoute } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { syncDesktopComposio } from '@/lib/desktop-composio'
import { ExternalLink } from '@/lib/external-link'
import { Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  addTavusMemory,
  createTavusDocument,
  createTavusVideo,
  deleteTavusMemory,
  deleteTavusProfile,
  getTavusProfile,
  listTavusCalls,
  listTavusDocuments,
  listTavusFaces,
  listTavusMemories,
  listTavusVoices,
  publishTavusShare,
  saveTavusMeeting,
  saveTavusProfile,
  saveTavusPronunciation,
  type TavusFace,
  type TavusProfile,
  type TavusVoice,
  trainTavusFace,
  trainTavusVoice,
  uploadTavusFile
} from '@/lib/verxio-api'
import { $gateway } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'
import { openTavusCall } from '@/store/tavus-call'

import { CONTROL_TEXT, EMPTY_SELECT_VALUE } from './constants'
import { SectionHeading, SettingsContent } from './primitives'

const EMPTY: TavusProfile = {
  configured: false,
  conferencingUsername: '',
  displayName: '',
  faceId: '',
  internetSearch: false,
  language: 'en',
  magicCanvas: false,
  meetingAllowlist: [],
  minutesUsed: 0,
  monthlyMinuteBudget: 60,
  neverDo: '',
  palId: '',
  personalityPrompt: '',
  region: '',
  shareUrl: '',
  spokenPrompt: '',
  taskToolReady: false,
  tone: '',
  voiceId: ''
}

interface CallHistoryRow {
  conversationId?: string
  kind?: string
  minutesUsed?: number
  perceptionSummary?: string
  startedAt?: string
  status?: string
  transcript?: Array<{ content?: string; role?: string }>
}

function transcriptText(call: CallHistoryRow): string {
  const turns = Array.isArray(call.transcript) ? call.transcript : []

  return turns
    .map(turn => `${turn.role || 'speaker'}: ${turn.content || ''}`.trim())
    .filter(Boolean)
    .join('\n')
}

export function PersonalitySettings() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<TavusProfile>(EMPTY)
  const [voices, setVoices] = useState<TavusVoice[]>([])
  const [faces, setFaces] = useState<TavusFace[]>([])
  const [facts, setFacts] = useState<Array<{ id: string; text: string }>>([])
  const [learned, setLearned] = useState('')
  const [documents, setDocuments] = useState<Array<{ id: string; name: string; status: string }>>([])
  const [calls, setCalls] = useState<CallHistoryRow[]>([])
  const [fact, setFact] = useState('')
  const [docUrl, setDocUrl] = useState('')
  const [username, setUsername] = useState('')
  const [word, setWord] = useState('Verxio')
  const [pronunciation, setPronunciation] = useState('VERK-see-oh')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [videoMessage, setVideoMessage] = useState('')
  const [videoUrl, setVideoUrl] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [next, voiceList, faceList, memory, docs, history] = await Promise.all([
          getTavusProfile(),
          listTavusVoices().catch(() => ({ voices: [] })),
          listTavusFaces().catch(() => ({ faces: [] })),
          listTavusMemories().catch(() => ({ facts: [], learned: '' })),
          listTavusDocuments().catch(() => ({ documents: [] })),
          listTavusCalls().catch(() => ({ calls: [] }))
        ])

        setProfile(next)
        setVoices(voiceList.voices)
        setFaces(faceList.faces)
        setFacts(memory.facts)
        setLearned(memory.learned)
        setDocuments(docs.documents)
        setCalls(history.calls as CallHistoryRow[])
        setUsername(next.conferencingUsername.replace(/^verxio-/, ''))
      } catch (error) {
        notifyError(error, 'Could not load personality')
      }
    })()
  }, [])

  const save = async () => {
    setBusy(true)

    try {
      const saved = await saveTavusProfile(profile)
      setProfile(saved)
      await syncDesktopComposio()
      notify({ kind: 'success', message: 'Personality saved' })
    } catch (error) {
      notifyError(error, 'Could not save personality')
    } finally {
      setBusy(false)
    }
  }

  const uploadAndTrain = async (file: File, kind: 'face' | 'voice') => {
    if (!consent) {
      notify({ kind: 'error', message: 'Confirm you have the rights to this likeness or voice.' })

      return
    }

    const data = await fileToDataUrl(file)
    const uploaded = await uploadTavusFile(file.name, data, file.type)

    if (kind === 'face') {
      const trained = await trainTavusFace({
        consent: true,
        imageUrl: file.type.startsWith('video/') ? undefined : uploaded.url,
        name: profile.displayName,
        videoUrl: file.type.startsWith('video/') ? uploaded.url : undefined,
        voiceId: profile.voiceId || undefined
      })

      notify({ kind: 'info', message: `Face training ${trained.status}` })
    } else {
      const trained = await trainTavusVoice({ audioUrl: uploaded.url, consent: true, name: profile.displayName })
      notify({ kind: 'info', message: `Voice training ${trained.status}` })
    }
  }

  const recordVideo = async () => {
    if (!profile.faceId) {
      notify({ kind: 'error', message: 'Choose a face before recording a video.' })

      return
    }

    const script =
      profile.spokenPrompt.trim() || (profile.displayName.trim() ? `Hi, I'm ${profile.displayName.trim()}.` : '')

    if (!script) {
      notify({ kind: 'error', message: 'Add a name or how they talk before recording a video.' })

      return
    }

    setBusy(true)

    try {
      const video = await createTavusVideo(script, profile.faceId)

      const message = video.hostedUrl
        ? `Video ${video.status}.`
        : `Video ${video.status || 'started'}. It will be ready in a few minutes.`

      setVideoUrl(video.hostedUrl || '')
      setVideoMessage(message)
      notify({ kind: 'success', message: video.hostedUrl ? `${message} Open the link below.` : message })
    } catch (error) {
      notifyError(error, 'Could not record a video')
    } finally {
      setBusy(false)
    }
  }

  const openInChat = async (call: CallHistoryRow) => {
    const gateway = $gateway.get()

    if (!gateway) {
      notify({ kind: 'error', message: 'Verxio is still starting.' })

      return
    }

    const transcript = transcriptText(call) || 'This call has no transcript yet.'

    try {
      const created = await gateway.request<{ session_id?: string; stored_session_id?: string }>('session.create', {})
      const sessionId = created.session_id || created.stored_session_id || ''

      if (!sessionId) {
        return
      }

      await gateway.request('session.title', { session_id: sessionId, title: 'Call follow-up' })
      await gateway.request('prompt.submit', {
        session_id: sessionId,
        text: `This is the transcript of a call with my Verxio agent. Use it as context for what I ask next.\n\n${transcript.slice(0, 12000)}`
      })
      navigate(sessionRoute(sessionId))
    } catch (error) {
      notifyError(error, 'Could not open this call in chat')
    }
  }

  return (
    <SettingsContent>
      <SectionHeading icon={Sparkles} title="Personality" />
      <p className="mb-3 text-xs text-(--ui-text-tertiary)">
        This is how your agent sounds in chat and on a call. Verxio still does the work.
      </p>
      <div className="flex max-w-xl flex-col gap-3">
        <Field
          label="Name"
          onChange={displayName => setProfile({ ...profile, displayName })}
          value={profile.displayName}
        />
        <Field label="How they talk" onChange={tone => setProfile({ ...profile, tone })} value={profile.tone} />
        <Field
          label="What they should never do"
          onChange={neverDo => setProfile({ ...profile, neverDo })}
          value={profile.neverDo}
        />
        <Choice
          label="Voice"
          onChange={voiceId => setProfile({ ...profile, voiceId })}
          options={voices}
          value={profile.voiceId}
        />
        <Choice
          label="Face"
          onChange={faceId => setProfile({ ...profile, faceId })}
          options={faces}
          value={profile.faceId}
        />
        <Field label="Language" onChange={language => setProfile({ ...profile, language })} value={profile.language} />
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={profile.region === 'eu'}
            onChange={event => setProfile({ ...profile, region: event.target.checked ? 'eu' : '' })}
            type="checkbox"
          />
          EU calls (AI disclosure, limited emotion recognition)
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={profile.internetSearch}
            onChange={event => setProfile({ ...profile, internetSearch: event.target.checked })}
            type="checkbox"
          />
          Internet search on calls
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={profile.magicCanvas}
            onChange={event => setProfile({ ...profile, magicCanvas: event.target.checked })}
            type="checkbox"
          />
          On-screen cards during calls
        </label>
        <Field
          label="Monthly call minutes"
          onChange={value => setProfile({ ...profile, monthlyMinuteBudget: Number(value) || 60 })}
          value={String(profile.monthlyMinuteBudget)}
        />
        <p className="text-xs text-(--ui-text-tertiary)">
          Used this month: {profile.minutesUsed} of {profile.monthlyMinuteBudget}
        </p>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button disabled={!profile.configured} onClick={() => openTavusCall()} variant="outline">
            Start call
          </Button>
        </div>
        <div className="flex gap-2">
          <Field label="Word" onChange={setWord} value={word} />
          <Field label="Say it like" onChange={setPronunciation} value={pronunciation} />
          <Button
            onClick={() =>
              void saveTavusPronunciation([{ pronunciation, word }]).then(() =>
                notify({ kind: 'success', message: 'Pronunciation saved' })
              )
            }
            variant="outline"
          >
            Save pronunciation
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input checked={consent} onChange={event => setConsent(event.target.checked)} type="checkbox" />I have the
          rights to train a face or voice from this media.
        </label>
        <label className="text-xs">
          Train a face
          <input
            accept="image/*,video/*"
            className="mt-1 block text-xs"
            onChange={event => {
              const file = event.target.files?.[0]

              if (file) {
                void uploadAndTrain(file, 'face')
              }
            }}
            type="file"
          />
        </label>
        <label className="text-xs">
          Clone a voice
          <input
            accept="audio/*,video/*"
            className="mt-1 block text-xs"
            onChange={event => {
              const file = event.target.files?.[0]

              if (file) {
                void uploadAndTrain(file, 'voice')
              }
            }}
            type="file"
          />
        </label>
        <div className="flex gap-2">
          <Field label="Pinned memory" onChange={setFact} value={fact} />
          <Button
            onClick={() =>
              void addTavusMemory(fact).then(next => {
                setFacts(next.facts)
                setFact('')
              })
            }
            variant="outline"
          >
            Pin
          </Button>
        </div>
        {facts.map(item => (
          <div className="flex items-center justify-between text-xs" key={item.id}>
            <span>{item.text}</span>
            <Button
              onClick={() => void deleteTavusMemory(item.id).then(next => setFacts(next.facts))}
              size="sm"
              variant="ghost"
            >
              Delete
            </Button>
          </div>
        ))}
        {learned && <p className="text-xs text-(--ui-text-tertiary)">Learned: {learned}</p>}
        <div className="flex gap-2">
          <Field label="Document or site URL" onChange={setDocUrl} value={docUrl} />
          <Button
            onClick={() =>
              void createTavusDocument({ name: docUrl, url: docUrl }).then(next => setDocuments(next.documents))
            }
            variant="outline"
          >
            Add
          </Button>
        </div>
        {documents.map(doc => (
          <p className="text-xs" key={doc.id}>
            {doc.name} · {doc.status}
          </p>
        ))}
        <div className="flex gap-2">
          <Field label="Meeting name" onChange={setUsername} value={username} />
          <Button
            onClick={() =>
              void saveTavusMeeting({ username }).then(saved => notify({ kind: 'success', message: saved.email }))
            }
            variant="outline"
          >
            Enable meetings
          </Button>
        </div>
        <Button
          onClick={() =>
            void publishTavusShare({ requireAuth: true }).then(share =>
              notify({ kind: 'success', message: share.url || 'Link ready' })
            )
          }
          variant="outline"
        >
          Copy share link
        </Button>
        {profile.shareUrl && <p className="text-xs">{profile.shareUrl}</p>}
        <div className="flex flex-col gap-2">
          <p className="text-xs">Calls</p>
          {calls.map(call => {
            const transcript = transcriptText(call)

            return (
              <div className="flex flex-col gap-1" key={String(call.conversationId)}>
                <p className="text-xs">
                  {String(call.kind || 'call')} · {String(call.status || '')} · {String(call.startedAt || '')} ·{' '}
                  {Number(call.minutesUsed || 0)} min
                </p>
                {call.perceptionSummary ? <p className="text-xs">{call.perceptionSummary}</p> : null}
                {transcript ? <p className="line-clamp-3 text-xs">{transcript}</p> : null}
                <Button onClick={() => void openInChat(call)} variant="outline">
                  Open in chat
                </Button>
              </div>
            )
          })}
        </div>
        <Button disabled={busy} onClick={() => void recordVideo()} variant="outline">
          Record a video message
        </Button>
        {videoMessage ? (
          <p className="text-xs">
            {videoMessage} {videoUrl ? <ExternalLink href={videoUrl}>Open video</ExternalLink> : null}
          </p>
        ) : null}
        <Button
          onClick={() =>
            void deleteTavusProfile().then(() => {
              setProfile(EMPTY)
              notify({ kind: 'info', message: 'Personality removed' })
            })
          }
          variant="destructive"
        >
          Reset personality
        </Button>
      </div>
    </SettingsContent>
  )
}

function Choice(props: {
  label: string
  onChange: (value: string) => void
  options: Array<{ id: string; name: string }>
  value: string
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span>{props.label}</span>
      <Select
        onValueChange={next => props.onChange(next === EMPTY_SELECT_VALUE ? '' : next)}
        value={props.value || EMPTY_SELECT_VALUE}
      >
        <SelectTrigger className={cn('w-full', CONTROL_TEXT)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="w-(--radix-select-trigger-width)">
          <SelectItem value={EMPTY_SELECT_VALUE}>None</SelectItem>
          {props.options.map(option => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Field(props: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs">
      {props.label}
      <input
        className="rounded border border-(--ui-stroke-tertiary) bg-transparent px-2 py-1"
        onChange={event => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
