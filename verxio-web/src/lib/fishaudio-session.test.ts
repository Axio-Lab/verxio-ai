import { describe, expect, it, vi } from 'vitest'

import {
  FISH_AUDIO_VOICES_CHANGED_EVENT,
  fishAudioAttachmentRef,
  fishAudioConfirmationParams,
  fishAudioToolChangedVoices,
  fishAudioToolConfirmation,
  fishAudioToolError,
  notifyFishAudioVoicesChanged,
  uploadFishAudioAttachment
} from './fishaudio-session'

describe('Fish Audio session contracts', () => {
  it('transports a session-bound opaque handle without a local path', async () => {
    const requestGateway = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      expect(params?.session_id).toBe('session-1')
      expect(params?.name).toBe('voice.m4a')
      expect(params?.data_url).toMatch(/^data:audio\/mp4;base64,/)

      return {
        attached: true,
        fishaudio_attachment_digest: 'sha256:abc',
        fishaudio_attachment_expires_in: 900,
        fishaudio_attachment_handle: 'fishatt_opaque-123'
      }
    })

    const file = new File(['audio'], '/Users/alice/private/voice.m4a', { type: 'audio/mp4' })
    const result = await uploadFishAudioAttachment(file, 'session-1', requestGateway)

    expect(fishAudioAttachmentRef(result.handle)).toBe('@audio:fishatt_opaque-123')
    expect(JSON.stringify(result)).not.toContain('/Users/alice')
    expect(requestGateway).toHaveBeenCalledWith('file.attach', expect.not.objectContaining({ path: expect.anything() }))
  })

  it('rejects unsafe attachment handles', () => {
    expect(() => fishAudioAttachmentRef('/Users/alice/voice.m4a')).toThrow(/invalid audio attachment handle/i)
    expect(() => fishAudioAttachmentRef('bad handle')).toThrow(/invalid audio attachment handle/i)
  })

  it('returns opaque confirmation data unchanged for cancellation or approval', () => {
    const confirmation = { signed: 'server-value', nested: { digest: 'sha256:abc' } }

    const cancelled = fishAudioConfirmationParams({
      approved: false,
      confirmation,
      requestId: 'request-1',
      sessionId: 'session-1'
    })

    expect(cancelled.approved).toBe(false)
    expect(cancelled.confirmation).toBe(confirmation)
    expect(cancelled).toMatchObject({ request_id: 'request-1', session_id: 'session-1' })
  })

  it('maps server create/delete confirmations without inventing authorization', () => {
    const confirmation = fishAudioToolConfirmation(
      'fishaudio_voice_delete',
      JSON.stringify({
        confirmation_required: true,
        confirmation_phrase: 'CONFIRM FISH VOICE DELETE ABCD1234',
        expires_in: 120
      }),
      'session-1',
      1_000
    )

    expect(confirmation).toMatchObject({
      action: 'delete',
      confirmation: 'CONFIRM FISH VOICE DELETE ABCD1234',
      expiresAt: new Date(121_000).toISOString(),
      sessionId: 'session-1'
    })
    expect(
      fishAudioToolConfirmation(
        'fishaudio_voice_design_persist',
        {
          confirmation_required: true,
          confirmation_phrase: 'CONFIRM FISH VOICE PERSIST ABCD1234',
          expires_in: 120
        },
        'session-1',
        1_000
      )
    ).toMatchObject({
      action: 'persist',
      confirmation: 'CONFIRM FISH VOICE PERSIST ABCD1234'
    })
    expect(fishAudioToolConfirmation('other_tool', '{}', 'session-1')).toBeNull()
  })

  it('refreshes only after a successful voice mutation', () => {
    expect(
      fishAudioToolChangedVoices('fishaudio_voice_set_default', {
        refresh_voices: true,
        success: true
      })
    ).toBe('set_default')
    expect(
      fishAudioToolChangedVoices('fishaudio_voice_delete', {
        error: 'provider failed',
        refresh_voices: true,
        success: false
      })
    ).toBeNull()
    expect(
      fishAudioToolChangedVoices('fishaudio_voice_design_persist', {
        refresh_voices: true,
        success: true
      })
    ).toBe('create')
    expect(
      fishAudioToolError('fishaudio_voice_delete', {
        error: 'Fish Audio rejected the request',
        success: false
      })
    ).toBe('Fish Audio rejected the request')
  })

  it('emits the picker refresh signal after voice changes', () => {
    const listener = vi.fn()
    window.addEventListener(FISH_AUDIO_VOICES_CHANGED_EVENT, listener)

    notifyFishAudioVoicesChanged('delete')

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ action: 'delete' })
    window.removeEventListener(FISH_AUDIO_VOICES_CHANGED_EVENT, listener)
  })
})
