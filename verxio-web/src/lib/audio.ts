import { transcribeAudio } from '@/hermes'
import { translateNow } from '@/i18n'

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
  const dataUrl = await blobToDataUrl(audio)
  const result = await transcribeAudio(dataUrl, audio.type)

  return result.transcript
}
