/**
 * Incremental TTS stream client over the TUI gateway JSON-RPC contract.
 *
 * Backend:
 *   tts.stream.open / text / flush / close
 *   events: tts.stream.chunk {stream_id,seq,data_b64}, tts.stream.end
 *
 * Playback uses MediaSource + SourceBuffer (`audio/mpeg`) when available.
 */

import type { GatewayEvent } from '@hermes/shared'

import { $gateway } from '@/store/gateway'
import { $activeSessionId } from '@/store/session'

const MAX_QUEUED_BYTES = 8 * 1024 * 1024
const MAX_B64_CHARS = 2 * 1024 * 1024

export type TtsStreamEndReason = 'complete' | 'cancelled' | 'error'

export interface TtsStreamOpenResult {
  mime_type?: string | null
  provider?: string | null
  stream_id?: string | null
  streaming: boolean
  reason?: string | null
  error?: string | null
}

export interface StreamSpeechOptions {
  onEnded?: (reason: TtsStreamEndReason, error?: string | null) => void
  sessionId?: string | null
  signal?: AbortSignal
}

export function canUseMpegMediaSource(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  if (typeof MediaSource === 'undefined') {
    return false
  }

  try {
    return MediaSource.isTypeSupported('audio/mpeg')
  } catch {
    return false
  }
}

function decodeChunk(dataB64: string): Uint8Array {
  if (!dataB64 || dataB64.length > MAX_B64_CHARS) {
    throw new Error('invalid TTS chunk')
  }

  const binary = atob(dataB64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

export class GatewayTtsStreamPlayer {
  private streamId: string | null = null
  private sessionId: string
  private mimeType = 'audio/mpeg'
  private mediaSource: MediaSource | null = null
  private sourceBuffer: SourceBuffer | null = null
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private pending: Uint8Array[] = []
  private queuedBytes = 0
  private nextSeq = 1
  private ended = false
  private closed = false
  private endReason: TtsStreamEndReason | null = null
  private endError: string | null = null
  private offEvent: (() => void) | null = null
  private waiters: Array<() => void> = []
  private appendBusy = false
  private readonly onEnded?: StreamSpeechOptions['onEnded']

  constructor(sessionId: string, options: StreamSpeechOptions = {}) {
    this.sessionId = sessionId
    this.onEnded = options.onEnded
  }

  get audioElement(): HTMLAudioElement | null {
    return this.audio
  }

  get id(): string | null {
    return this.streamId
  }

  async open(): Promise<boolean> {
    const gateway = $gateway.get()

    if (!gateway || gateway.connectionState !== 'open') {
      return false
    }

    if (!canUseMpegMediaSource()) {
      return false
    }

    const result = await gateway.request<TtsStreamOpenResult>('tts.stream.open', {
      session_id: this.sessionId,
      format: 'mp3'
    })

    if (!result?.streaming || !result.stream_id) {
      return false
    }

    this.streamId = result.stream_id
    this.mimeType = result.mime_type || 'audio/mpeg'
    this.offEvent = gateway.onEvent(event => this.handleEvent(event))

    this.mediaSource = new MediaSource()
    this.audio = new Audio()
    this.objectUrl = URL.createObjectURL(this.mediaSource)
    this.audio.src = this.objectUrl

    await new Promise<void>((resolve, reject) => {
      const ms = this.mediaSource

      if (!ms) {
        reject(new Error('MediaSource missing'))

        return
      }

      const onSourceOpen = () => {
        ms.removeEventListener('sourceopen', onSourceOpen)

        try {
          this.sourceBuffer = ms.addSourceBuffer(this.mimeType)
          this.sourceBuffer.addEventListener('updateend', () => {
            this.appendBusy = false
            this.drainPending()
          })
          resolve()
        } catch (error) {
          reject(error)
        }
      }

      ms.addEventListener('sourceopen', onSourceOpen)
    })

    void this.audio.play().catch(() => {
      // Autoplay may be deferred until the first buffer; ignore here.
    })

    return true
  }

  async sendText(text: string): Promise<void> {
    const gateway = $gateway.get()
    const streamId = this.streamId

    if (!gateway || !streamId || this.closed) {
      return
    }

    const clean = text.trim()

    if (!clean) {
      return
    }

    await gateway.request('tts.stream.text', {
      session_id: this.sessionId,
      stream_id: streamId,
      text: clean
    })
  }

  async flush(): Promise<void> {
    const gateway = $gateway.get()
    const streamId = this.streamId

    if (!gateway || !streamId || this.closed) {
      return
    }

    await gateway.request('tts.stream.flush', {
      session_id: this.sessionId,
      stream_id: streamId
    })
  }

  async close(cancel = false): Promise<void> {
    if (this.closed) {
      return
    }

    this.closed = true
    const gateway = $gateway.get()
    const streamId = this.streamId

    if (gateway && streamId) {
      try {
        await gateway.request('tts.stream.close', {
          session_id: this.sessionId,
          stream_id: streamId,
          cancel
        })
      } catch {
        // Best-effort close.
      }
    }

    if (cancel) {
      this.finishLocal('cancelled')
    }
  }

  async waitUntilEnded(): Promise<TtsStreamEndReason> {
    if (this.endReason) {
      return this.endReason
    }

    await new Promise<void>(resolve => {
      this.waiters.push(resolve)
    })

    return this.endReason || 'complete'
  }

  private handleEvent(event: GatewayEvent): void {
    if (this.closed && event.type !== 'tts.stream.end') {
      return
    }

    if (event.session_id && event.session_id !== this.sessionId) {
      return
    }

    const payload = (event.payload || {}) as Record<string, unknown>
    const streamId = typeof payload.stream_id === 'string' ? payload.stream_id : ''

    if (!this.streamId || streamId !== this.streamId) {
      return
    }

    if (event.type === 'tts.stream.chunk') {
      const seq = Number(payload.seq || 0)
      const dataB64 = typeof payload.data_b64 === 'string' ? payload.data_b64 : ''

      if (!Number.isFinite(seq) || seq !== this.nextSeq) {
        void this.close(true)
        this.finishLocal('error', 'out-of-order TTS chunk')

        return
      }

      this.nextSeq += 1

      try {
        const bytes = decodeChunk(dataB64)

        if (this.queuedBytes + bytes.byteLength > MAX_QUEUED_BYTES) {
          void this.close(true)
          this.finishLocal('error', 'TTS buffer overflow')

          return
        }

        this.queuedBytes += bytes.byteLength
        this.pending.push(bytes)
        this.drainPending()
      } catch (error) {
        void this.close(true)
        this.finishLocal('error', error instanceof Error ? error.message : 'bad chunk')
      }

      return
    }

    if (event.type === 'tts.stream.end') {
      const reasonRaw = String(payload.reason || 'complete')
      const reason: TtsStreamEndReason = reasonRaw === 'cancelled' || reasonRaw === 'error' ? reasonRaw : 'complete'
      const error = typeof payload.error === 'string' ? payload.error : null
      this.finishLocal(reason, error)
    }
  }

  private drainPending(): void {
    const sb = this.sourceBuffer
    const ms = this.mediaSource

    if (!sb || this.appendBusy) {
      return
    }

    if (this.pending.length === 0) {
      if (this.ended && ms && ms.readyState === 'open') {
        try {
          ms.endOfStream()
        } catch {
          // Ignore if already ended.
        }
      }

      return
    }

    const next = this.pending.shift()

    if (!next) {
      return
    }

    this.queuedBytes = Math.max(0, this.queuedBytes - next.byteLength)
    this.appendBusy = true

    try {
      // Copy into a fresh ArrayBuffer — SourceBuffer rejects SharedArrayBuffer views.
      const copy = new Uint8Array(next.byteLength)
      copy.set(next)
      sb.appendBuffer(copy)
    } catch (error) {
      this.appendBusy = false
      void this.close(true)
      this.finishLocal('error', error instanceof Error ? error.message : 'append failed')
    }
  }

  private finishLocal(reason: TtsStreamEndReason, error: string | null = null): void {
    if (this.endReason) {
      return
    }

    this.ended = true
    this.endReason = reason
    this.endError = error
    this.closed = true
    this.offEvent?.()
    this.offEvent = null
    this.drainPending()

    if (reason === 'cancelled' || reason === 'error') {
      this.releaseMedia()
    } else if (this.audio) {
      const audio = this.audio
      const settle = () => {
        this.releaseMedia()
        this.notifyEnded()
      }

      if (audio.ended || audio.paused) {
        settle()
      } else {
        audio.addEventListener('ended', settle, { once: true })
        // Safety timeout if ended never fires.
        window.setTimeout(settle, 30_000)
      }

      return
    }

    this.notifyEnded()
  }

  private notifyEnded(): void {
    for (const resolve of this.waiters.splice(0)) {
      resolve()
    }

    this.onEnded?.(this.endReason || 'complete', this.endError)
  }

  private releaseMedia(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
      this.audio = null
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }

    this.sourceBuffer = null
    this.mediaSource = null
    this.pending = []
    this.queuedBytes = 0
  }
}

export async function openGatewayTtsStream(options: StreamSpeechOptions = {}): Promise<GatewayTtsStreamPlayer | null> {
  const sessionId = options.sessionId || $activeSessionId.get()

  if (!sessionId) {
    return null
  }

  const player = new GatewayTtsStreamPlayer(sessionId, options)

  try {
    const opened = await player.open()

    if (!opened) {
      await player.close(true)

      return null
    }

    if (options.signal?.aborted) {
      await player.close(true)

      return null
    }

    options.signal?.addEventListener(
      'abort',
      () => {
        void player.close(true)
      },
      { once: true }
    )

    return player
  } catch {
    await player.close(true)

    return null
  }
}
