import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { endTavusConversation, startTavusConversation } from '@/lib/verxio-api'
import { notifyError } from '@/store/notifications'
import { $tavusCallLive, closeTavusCall } from '@/store/tavus-call'

interface DailyCall {
  destroy: () => Promise<void>
  join: (options: { token?: string; url: string }) => Promise<void>
  leave: () => Promise<void>
  on: (event: string, handler: () => void) => void
  participants: () => Record<string, { tracks?: { video?: { persistentTrack?: MediaStreamTrack; state?: string } } }>
  sendAppMessage: (data: unknown, to: string) => void
  setLocalAudio: (enabled: boolean) => void
  setLocalVideo: (enabled: boolean) => void
  startScreenShare: () => void
  stopScreenShare: () => void
}

let activeCall: DailyCall | null = null

export function tavusCallIsLive(): boolean {
  return $tavusCallLive.get() && activeCall !== null
}

export async function speakOnTavusCall(conversationId: string, text: string): Promise<void> {
  if (!activeCall || !$tavusCallLive.get()) {
    return
  }

  activeCall.sendAppMessage(
    {
      conversation_id: conversationId,
      event_type: 'conversation.append_context',
      message_type: 'conversation',
      properties: { context: text }
    },
    '*'
  )
  activeCall.sendAppMessage(
    {
      conversation_id: conversationId,
      event_type: 'conversation.respond',
      message_type: 'conversation',
      properties: { text }
    },
    '*'
  )
}

export function TavusCallPanel() {
  const live = useStore($tavusCallLive)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const callRef = useRef<DailyCall | null>(null)
  const conversationRef = useRef('')
  const [audioOnly, setAudioOnly] = useState(false)
  const [meetingUrl, setMeetingUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)

  const leave = async () => {
    const conversationId = conversationRef.current
    const call = callRef.current
    callRef.current = null
    activeCall = null
    $tavusCallLive.set(false)

    if (call) {
      await call.leave().catch(() => undefined)
      await call.destroy().catch(() => undefined)
    }

    if (conversationId) {
      await endTavusConversation(conversationId).catch(() => undefined)
    }

    conversationRef.current = ''
  }

  useEffect(() => {
    const onHide = () => {
      if (conversationRef.current) {
        void endTavusConversation(conversationRef.current)
      }
    }

    window.addEventListener('beforeunload', onHide)

    return () => {
      window.removeEventListener('beforeunload', onHide)
      void leave()
    }
  }, [])

  const attachVideo = (call: DailyCall) => {
    const video = videoRef.current

    if (!video) {
      return
    }
    const remotes = Object.values(call.participants())
    const track = remotes.map(person => person.tracks?.video?.persistentTrack).find(Boolean)

    if (track) {
      video.srcObject = new MediaStream([track])
    }
  }

  const start = async () => {
    setBusy(true)

    try {
      await window.hermesDesktop?.requestMicrophoneAccess?.()

      if (!audioOnly) {
        await window.hermesDesktop?.requestCameraAccess?.()
      }

      const started = await startTavusConversation({
        audioOnly,
        meetingUrl: meetingUrl.trim() || undefined
      })

      conversationRef.current = started.conversationId

      const daily = (await import('@daily-co/daily-js')) as unknown as {
        default: { createCallObject: () => DailyCall }
      }

      const call = daily.default.createCallObject()
      callRef.current = call
      activeCall = call
      call.on('participant-joined', () => attachVideo(call))
      call.on('participant-updated', () => attachVideo(call))
      await call.join({
        url: started.conversationUrl,
        ...(started.meetingToken ? { token: started.meetingToken } : {})
      })

      if (audioOnly) {
        call.setLocalVideo(false)
      }

      $tavusCallLive.set(true)
    } catch (error) {
      notifyError(error, 'Could not start the call')
      await leave()
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(100%,28rem)] flex-col border-l border-(--ui-stroke-tertiary) bg-(--ui-editor-surface-background)">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-sm text-(--ui-text-primary)">Call</p>
        <Button onClick={() => closeTavusCall()} size="sm" variant="ghost">
          Close
        </Button>
      </div>
      <video autoPlay className="mx-3 aspect-video bg-black" playsInline ref={videoRef} />
      {!live && (
        <div className="flex flex-col gap-2 p-3">
          <label className="flex items-center gap-2 text-xs text-(--ui-text-secondary)">
            <input checked={audioOnly} onChange={event => setAudioOnly(event.target.checked)} type="checkbox" />
            Audio only
          </label>
          <input
            className="rounded border border-(--ui-stroke-tertiary) bg-transparent px-2 py-1 text-xs"
            onChange={event => setMeetingUrl(event.target.value)}
            placeholder="Paste a Meet, Zoom, or Teams link"
            value={meetingUrl}
          />
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Start call'}
          </Button>
        </div>
      )}
      {live && (
        <div className="flex gap-2 p-3">
          <Button
            onClick={() => {
              const call = callRef.current

              if (!call) {
                return
              }

              if (sharing) {
                call.stopScreenShare()
              } else {
                call.startScreenShare()
              }

              setSharing(next => !next)
            }}
            size="sm"
            variant="outline"
          >
            {sharing ? 'Stop sharing' : 'Share screen'}
          </Button>
          <Button onClick={() => void leave()} size="sm" variant="destructive">
            Leave
          </Button>
        </div>
      )}
    </aside>
  )
}
