import type { FishAudioConfirmationRequest } from '@/store/prompts'
import type { FishAudioAttachmentUploadResponse, FishAudioConfirmationData, FishAudioVoiceAction } from '@/types/hermes'

export const FISH_AUDIO_VOICES_CHANGED_EVENT = 'verxio:fishaudio-voices-changed'

const SAFE_HANDLE_PATTERN = /^fishatt_[A-Za-z0-9_-]{8,256}$/

export function fishAudioAttachmentRef(handle: string): string {
  const value = handle.trim()

  if (!SAFE_HANDLE_PATTERN.test(value)) {
    throw new Error('Verxio returned an invalid audio attachment handle.')
  }

  return `@audio:${value}`
}

export async function uploadFishAudioAttachment(
  file: File,
  sessionId: string,
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
): Promise<FishAudioAttachmentUploadResponse> {
  const safeName = file.name.split(/[\\/]/).filter(Boolean).pop() || 'audio'

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read audio attachment.'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })

  const result = await requestGateway<{
    attached?: boolean
    fishaudio_attachment_digest?: string
    fishaudio_attachment_expires_at?: string
    fishaudio_attachment_expires_in?: number
    fishaudio_attachment_handle?: string
  }>('file.attach', {
    data_url: dataUrl,
    name: safeName,
    session_id: sessionId
  })

  const handle = result.fishaudio_attachment_handle || ''
  fishAudioAttachmentRef(handle)

  if (!result.attached) {
    throw new Error('Verxio returned an invalid session audio attachment.')
  }

  return {
    attached: true,
    digest: result.fishaudio_attachment_digest,
    expires_at: result.fishaudio_attachment_expires_at,
    expires_in: result.fishaudio_attachment_expires_in,
    file_name: safeName,
    handle,
    mime_type: file.type,
    session_id: sessionId,
    size_bytes: file.size
  }
}

export function notifyFishAudioVoicesChanged(action: FishAudioVoiceAction): void {
  window.dispatchEvent(
    new CustomEvent(FISH_AUDIO_VOICES_CHANGED_EVENT, {
      detail: { action }
    })
  )
}

export function fishAudioConfirmationParams(input: {
  approved: boolean
  confirmation: FishAudioConfirmationData
  requestId: string
  sessionId: string | null
}): Record<string, unknown> {
  return {
    approved: input.approved,
    confirmation: input.confirmation,
    request_id: input.requestId,
    session_id: input.sessionId ?? undefined
  }
}

function resultRecord(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>
  }

  if (typeof result !== 'string') {
    return {}
  }

  try {
    const parsed = JSON.parse(result)

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function fishAudioToolConfirmation(
  toolName: string,
  result: unknown,
  sessionId: string | null,
  now = Date.now()
): FishAudioConfirmationRequest | null {
  const action: FishAudioVoiceAction | null =
    toolName === 'fishaudio_voice_create' ? 'create' : toolName === 'fishaudio_voice_delete' ? 'delete' : null

  if (!action) {
    return null
  }

  const payload = resultRecord(result)
  const confirmation = payload.confirmation_data ?? payload.confirmation_phrase

  if (
    payload.confirmation_required !== true ||
    (typeof confirmation !== 'string' &&
      (confirmation === null || typeof confirmation !== 'object' || Array.isArray(confirmation)))
  ) {
    return null
  }

  const expiresAt =
    typeof payload.expires_at === 'string'
      ? payload.expires_at
      : new Date(now + Math.max(1, Number(payload.expires_in) || 0) * 1000).toISOString()

  return {
    action,
    actionLabel:
      typeof payload.action_label === 'string'
        ? payload.action_label
        : action === 'create'
          ? 'Create a private Fish Audio voice'
          : 'Delete the selected Fish Audio voice',
    attachmentDigest: typeof payload.attachment_digest === 'string' ? payload.attachment_digest : undefined,
    confirmation: confirmation as FishAudioConfirmationData,
    description: typeof payload.description === 'string' ? payload.description : undefined,
    expiresAt,
    requestId: typeof payload.request_id === 'string' ? payload.request_id : String(confirmation),
    sessionId
  }
}

export function fishAudioToolChangedVoices(toolName: string, result: unknown): FishAudioVoiceAction | null {
  const payload = resultRecord(result)

  if (payload.success !== true || payload.refresh_voices !== true) {
    return null
  }

  return toolName === 'fishaudio_voice_create'
    ? 'create'
    : toolName === 'fishaudio_voice_delete'
      ? 'delete'
      : toolName === 'fishaudio_voice_set_default'
        ? 'set_default'
        : null
}

export function fishAudioToolError(toolName: string, result: unknown): string | null {
  if (
    toolName !== 'fishaudio_voice_create' &&
    toolName !== 'fishaudio_voice_delete' &&
    toolName !== 'fishaudio_voice_set_default'
  ) {
    return null
  }

  const payload = resultRecord(result)

  return payload.success === false && typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : null
}
