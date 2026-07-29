import { speakText } from '@/hermes'
import {
  $voicePlayback,
  setVoicePlaybackState,
  type VoicePlaybackSource,
  type VoicePlaybackState
} from '@/store/voice-playback'

import { sanitizeTextForSpeech } from './speech-text'
import type { GatewayTtsStreamPlayer } from './tts-stream-playback'
import { openGatewayTtsStream, type TtsStreamEndReason } from './tts-stream-playback'

let currentAudio: HTMLAudioElement | null = null
let currentStop: (() => void) | null = null
let currentStream: GatewayTtsStreamPlayer | null = null
let sequence = 0

function currentState(
  status: VoicePlaybackState['status'],
  options?: VoicePlaybackOptions,
  audioElement: HTMLAudioElement | null = null
): VoicePlaybackState {
  return {
    audioElement,
    messageId: options?.messageId ?? null,
    sequence,
    source: options?.source ?? null,
    status
  }
}

export interface VoicePlaybackOptions {
  messageId?: string | null
  source: VoicePlaybackSource
}

export function stopVoicePlayback() {
  sequence += 1
  currentStop?.()
  currentStop = null

  const stream = currentStream
  currentStream = null

  if (stream) {
    void stream.close(true)
  }

  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio.load()
    currentAudio = null
  }

  setVoicePlaybackState({
    audioElement: null,
    messageId: null,
    sequence,
    source: null,
    status: 'idle'
  })
}

export async function beginStreamedSpeech(options: VoicePlaybackOptions): Promise<GatewayTtsStreamPlayer | null> {
  stopVoicePlayback()

  const ownSequence = sequence
  setVoicePlaybackState(currentState('preparing', options))

  const player = await openGatewayTtsStream({
    onEnded: (_reason: TtsStreamEndReason) => {
      if (ownSequence !== sequence) {
        return
      }

      currentStream = null
      currentAudio = null
      setVoicePlaybackState(currentState('idle'))
    }
  })

  if (!player || ownSequence !== sequence) {
    if (player) {
      await player.close(true)
    }

    if (ownSequence === sequence) {
      setVoicePlaybackState(currentState('idle'))
    }

    return null
  }

  currentStream = player
  currentAudio = player.audioElement

  currentStop = () => {
    void player.close(true)
  }

  setVoicePlaybackState(currentState('speaking', options, player.audioElement))

  return player
}

export async function appendStreamedSpeech(player: GatewayTtsStreamPlayer, text: string): Promise<void> {
  const speakable = sanitizeTextForSpeech(text)

  if (!speakable) {
    return
  }

  await player.sendText(speakable)
  await player.flush()
}

export async function finishStreamedSpeech(
  player: GatewayTtsStreamPlayer,
  cancel = false
): Promise<TtsStreamEndReason> {
  await player.close(cancel)

  if (!cancel) {
    return player.waitUntilEnded()
  }

  return 'cancelled'
}

export async function playSpeechText(text: string, options: VoicePlaybackOptions): Promise<boolean> {
  stopVoicePlayback()

  const speakableText = sanitizeTextForSpeech(text)

  if (!speakableText) {
    return false
  }

  const ownSequence = sequence
  const isCurrent = () => ownSequence === sequence

  setVoicePlaybackState(currentState('preparing', options))

  try {
    const response = await speakText(speakableText)

    if (!isCurrent()) {
      return false
    }

    const audio = new Audio(response.data_url)
    currentAudio = audio
    setVoicePlaybackState(currentState('speaking', options, audio))

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        currentStop = null
      }

      const onEnded = () => {
        cleanup()
        resolve()
      }

      const onError = () => {
        cleanup()
        reject(new Error('Playback failed'))
      }

      currentStop = () => {
        cleanup()
        resolve()
      }

      audio.addEventListener('ended', onEnded, { once: true })
      audio.addEventListener('error', onError, { once: true })
      void audio.play().catch(reject)
    })

    if (!isCurrent()) {
      return false
    }

    currentAudio = null
    setVoicePlaybackState(currentState('idle'))

    return true
  } catch (error) {
    if (isCurrent()) {
      currentStop = null
      currentAudio = null
      setVoicePlaybackState(currentState('idle'))
    }

    throw error
  }
}

export function isVoicePlaybackActive() {
  return $voicePlayback.get().status !== 'idle'
}
