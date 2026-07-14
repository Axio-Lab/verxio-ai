import type { CloudTranscriptionProvider, CloudTranscriptionProviderId } from '@/lib/transcription-providers'
import type { HermesConfigRecord } from '@/types/hermes'

export const STT_MODEL_CONFIG_PATHS: Partial<Record<CloudTranscriptionProviderId, string>> = {
  elevenlabs: 'stt.elevenlabs.model_id',
  groq: 'stt.groq.model',
  mistral: 'stt.mistral.model',
  openai: 'stt.openai.model'
}

const POLLUTING_PATH_PARTS = new Set(['__proto__', 'constructor', 'prototype'])

function safePathParts(path: string): string[] {
  const parts = path.split('.')

  if (!parts.every(part => part.length > 0 && !POLLUTING_PATH_PARTS.has(part))) {
    throw new Error(`Unsafe config path: ${path}`)
  }

  return parts
}

export function configValue(config: HermesConfigRecord, path: string): unknown {
  let current: unknown = config

  for (const part of safePathParts(path)) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined
    }

    current = (current as Record<string, unknown>)[part]
  }

  return current
}

export function setConfigValue(config: HermesConfigRecord, path: string, value: unknown): HermesConfigRecord {
  const next = structuredClone(config)
  const parts = safePathParts(path)
  let current: Record<string, unknown> = next

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    const existing = current[part]

    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[part] = {}
    }

    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value

  return next
}

export function selectedCloudTranscriptionProvider(
  config: HermesConfigRecord,
  providers: CloudTranscriptionProvider[]
): CloudTranscriptionProvider {
  const configured = String(configValue(config, 'stt.provider') ?? '')

  return providers.find(provider => provider.id === configured) ?? providers[0]
}

export function configuredCloudTranscriptionProvider(
  config: HermesConfigRecord,
  providers: CloudTranscriptionProvider[]
): CloudTranscriptionProvider | undefined {
  const configured = String(configValue(config, 'stt.provider') ?? '')

  return providers.find(provider => provider.id === configured)
}

export function selectedCloudTranscriptionModel(
  config: HermesConfigRecord,
  provider: CloudTranscriptionProvider
): string {
  const path = STT_MODEL_CONFIG_PATHS[provider.id]
  const configured = path ? String(configValue(config, path) ?? '') : ''

  return configured || provider.recommendedModel
}

export function applyCloudTranscriptionConfig(
  config: HermesConfigRecord,
  provider: CloudTranscriptionProvider,
  model: string
): HermesConfigRecord {
  const selectedModel = model.trim() || provider.recommendedModel
  let next = setConfigValue(config, 'stt.enabled', true)
  next = setConfigValue(next, 'stt.provider', provider.id)

  const path = STT_MODEL_CONFIG_PATHS[provider.id]

  if (path) {
    next = setConfigValue(next, path, selectedModel)
  }

  return next
}
