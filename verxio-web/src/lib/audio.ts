import { transcribeAudio } from '@/hermes'
import { translateNow } from '@/i18n'

/** Raw audio limit before base64 JSON overhead (~33%) and the runtime 25 MiB decode cap. */
export const MAX_TRANSCRIPTION_BYTES = 18 * 1024 * 1024

export const NOTEPAD_MAX_RECORDING_SECONDS = 60 * 60
export const NOTEPAD_RECORDING_BITS_PER_SECOND = 24_000

export function assertTranscriptionSize(audio: Blob): void {
  if (audio.size > MAX_TRANSCRIPTION_BYTES) {
    throw new Error(
      'Recording is too large to transcribe in one request. The audio can still be saved as an artifact; try a shorter recording or split the meeting into segments.'
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

  return transcribeAudioDataUrl(dataUrl, audio.type)
}

export async function transcribeAudioDataUrl(dataUrl: string, mimeType?: string): Promise<string> {
  const result = await transcribeAudio(dataUrl, mimeType)

  return result.transcript
}
