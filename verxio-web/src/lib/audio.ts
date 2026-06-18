import { transcribeAudio } from '@/hermes'
import { translateNow } from '@/i18n'

/** Raw audio limit before base64 JSON overhead (~33%) and Hermes 25 MiB decode cap. */
export const MAX_TRANSCRIPTION_BYTES = 18 * 1024 * 1024

export const NOTEPAD_RECORDING_BITS_PER_SECOND = 64_000

export function assertTranscriptionSize(audio: Blob): void {
  if (audio.size > MAX_TRANSCRIPTION_BYTES) {
    throw new Error(
      'Recording is too large to transcribe. Stop sooner and transcribe in shorter segments (about 10 minutes or less).'
    )
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error(translateNow('desktop.audioReadFailed')))
      }
    })
    reader.addEventListener('error', () => reject(reader.error || new Error(translateNow('desktop.audioReadFailed'))))
    reader.readAsDataURL(blob)
  })
}

export async function transcribeAudioBlob(audio: Blob): Promise<string> {
  assertTranscriptionSize(audio)
  const dataUrl = await blobToDataUrl(audio)
  const result = await transcribeAudio(dataUrl, audio.type)

  return result.transcript
}
