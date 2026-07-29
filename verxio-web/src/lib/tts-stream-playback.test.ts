import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GatewayTtsStreamPlayer, canUseMpegMediaSource } from './tts-stream-playback'

const request = vi.fn()
const onEvent = vi.fn()
let eventHandler: ((event: { type: string; session_id?: string; payload?: Record<string, unknown> }) => void) | null =
  null

vi.mock('@/store/gateway', () => ({
  $gateway: {
    get: () => ({
      connectionState: 'open',
      request,
      onEvent: (handler: typeof eventHandler) => {
        eventHandler = handler
        onEvent(handler)

        return () => {
          if (eventHandler === handler) {
            eventHandler = null
          }
        }
      }
    })
  }
}))

vi.mock('@/store/session', () => ({
  $activeSessionId: { get: () => 'session-1' }
}))

describe('canUseMpegMediaSource', () => {
  it('reports MediaSource MPEG support', () => {
    expect(typeof canUseMpegMediaSource()).toBe('boolean')
  })
})

describe('GatewayTtsStreamPlayer', () => {
  beforeEach(() => {
    request.mockReset()
    onEvent.mockReset()
    eventHandler = null

    class FakeSourceBuffer extends EventTarget {
      appendBuffer = vi.fn(() => {
        queueMicrotask(() => this.dispatchEvent(new Event('updateend')))
      })
    }

    class FakeMediaSource extends EventTarget {
      readyState = 'open'
      sourceBuffers: FakeSourceBuffer[] = []
      addSourceBuffer = vi.fn(() => {
        const sb = new FakeSourceBuffer()
        this.sourceBuffers.push(sb)
        return sb
      })
      endOfStream = vi.fn()
    }

    vi.stubGlobal(
      'MediaSource',
      Object.assign(FakeMediaSource, {
        isTypeSupported: () => true
      })
    )
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: () => 'blob:tts',
        revokeObjectURL: vi.fn()
      })
    )
    vi.stubGlobal(
      'Audio',
      class {
        src = ''
        paused = false
        ended = false
        play = vi.fn(async () => undefined)
        pause = vi.fn()
        load = vi.fn()
        removeAttribute = vi.fn()
        addEventListener = vi.fn()
      }
    )
  })

  it('opens a stream, appends ordered chunks, and finishes on end', async () => {
    request.mockImplementation(async (method: string) => {
      if (method === 'tts.stream.open') {
        return {
          streaming: true,
          stream_id: 'stream-1',
          provider: 'fishaudio',
          mime_type: 'audio/mpeg'
        }
      }

      return { status: 'ok' }
    })

    const player = new GatewayTtsStreamPlayer('session-1')
    const openPromise = player.open()

    // MediaSource sourceopen
    await Promise.resolve()
    const ms = (player as unknown as { mediaSource: EventTarget | null }).mediaSource
    ms?.dispatchEvent(new Event('sourceopen'))

    await expect(openPromise).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith('tts.stream.open', {
      session_id: 'session-1',
      format: 'mp3'
    })

    await player.sendText('Hello there.')
    expect(request).toHaveBeenCalledWith('tts.stream.text', {
      session_id: 'session-1',
      stream_id: 'stream-1',
      text: 'Hello there.'
    })

    const chunk = btoa('abc')
    eventHandler?.({
      type: 'tts.stream.chunk',
      session_id: 'session-1',
      payload: { stream_id: 'stream-1', seq: 1, data_b64: chunk }
    })

    eventHandler?.({
      type: 'tts.stream.end',
      session_id: 'session-1',
      payload: { stream_id: 'stream-1', reason: 'complete' }
    })

    await expect(player.waitUntilEnded()).resolves.toBe('complete')
  })

  it('ignores events for other streams', async () => {
    request.mockResolvedValue({
      streaming: true,
      stream_id: 'stream-1',
      mime_type: 'audio/mpeg'
    })

    const player = new GatewayTtsStreamPlayer('session-1')
    const openPromise = player.open()
    await Promise.resolve()
    ;(player as unknown as { mediaSource: EventTarget | null }).mediaSource?.dispatchEvent(new Event('sourceopen'))
    await openPromise

    eventHandler?.({
      type: 'tts.stream.chunk',
      session_id: 'session-1',
      payload: { stream_id: 'other', seq: 1, data_b64: btoa('x') }
    })

    // Still expecting seq 1 for stream-1; a valid chunk should still work.
    eventHandler?.({
      type: 'tts.stream.chunk',
      session_id: 'session-1',
      payload: { stream_id: 'stream-1', seq: 1, data_b64: btoa('ok') }
    })
    eventHandler?.({
      type: 'tts.stream.end',
      session_id: 'session-1',
      payload: { stream_id: 'stream-1', reason: 'complete' }
    })

    await expect(player.waitUntilEnded()).resolves.toBe('complete')
  })

  it('returns false when backend disables streaming', async () => {
    request.mockResolvedValue({ streaming: false, stream_id: null })
    const player = new GatewayTtsStreamPlayer('session-1')
    await expect(player.open()).resolves.toBe(false)
  })
})
