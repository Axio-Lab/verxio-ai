export type CloudTranscriptionProviderId = 'elevenlabs' | 'groq' | 'mistral' | 'openai' | 'xai'

export interface CloudTranscriptionProvider {
  catalogError?: string | null
  catalogSource?: 'fallback' | 'provider'
  configured?: boolean
  description: string
  docsUrl: string
  envKey: string
  fetchedAt?: string | null
  id: CloudTranscriptionProviderId
  label: string
  models: string[]
  recommendedModel: string
}

export interface CloudTranscriptionCatalogModel {
  id: string
  source: 'fallback' | 'provider'
}

export interface CloudTranscriptionCatalogProvider {
  configured: boolean
  description: string
  docsUrl: string
  envKey: string
  error?: string | null
  fetchedAt?: string | null
  id: CloudTranscriptionProviderId
  label: string
  models: CloudTranscriptionCatalogModel[]
  recommendedModel: string
  source: 'fallback' | 'provider'
}

export interface CloudTranscriptionCatalogResponse {
  cacheTtlSeconds: number
  providers: CloudTranscriptionCatalogProvider[]
}

export const FALLBACK_CLOUD_TRANSCRIPTION_PROVIDERS: CloudTranscriptionProvider[] = [
  {
    id: 'groq',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    recommendedModel: 'whisper-large-v3-turbo',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    docsUrl: 'https://console.groq.com/keys',
    description: 'Fast, low-cost Whisper transcription. Create an API key in the Groq console.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'VOICE_TOOLS_OPENAI_KEY',
    recommendedModel: 'gpt-4o-mini-transcribe',
    models: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    docsUrl: 'https://platform.openai.com/api-keys',
    description: 'High-quality hosted transcription. Create an API key in the OpenAI platform dashboard.'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    recommendedModel: 'voxtral-mini-latest',
    models: ['voxtral-mini-latest', 'voxtral-mini-2602'],
    docsUrl: 'https://console.mistral.ai/api-keys',
    description: 'Voxtral transcription from Mistral. Create an API key in the Mistral console.'
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    envKey: 'ELEVENLABS_API_KEY',
    recommendedModel: 'scribe_v2',
    models: ['scribe_v2', 'scribe_v1'],
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    description: 'Scribe transcription and premium voice features. Create an API key in ElevenLabs settings.'
  },
  {
    id: 'xai',
    label: 'xAI',
    envKey: 'XAI_API_KEY',
    recommendedModel: 'grok-stt',
    models: ['grok-stt'],
    docsUrl: 'https://console.x.ai/',
    description: 'Optional Grok speech-to-text provider. Create an API key in the xAI console.'
  }
]

export const CLOUD_TRANSCRIPTION_PROVIDERS = FALLBACK_CLOUD_TRANSCRIPTION_PROVIDERS

export const CLOUD_TRANSCRIPTION_ENV_KEYS = CLOUD_TRANSCRIPTION_PROVIDERS.map(provider => provider.envKey)

export function cloudTranscriptionProviderById(
  id: string | null | undefined,
  providers: CloudTranscriptionProvider[] = CLOUD_TRANSCRIPTION_PROVIDERS
): CloudTranscriptionProvider | undefined {
  return providers.find(provider => provider.id === id)
}

export function cloudTranscriptionProviderForEnvKey(
  envKey: string,
  providers: CloudTranscriptionProvider[] = CLOUD_TRANSCRIPTION_PROVIDERS
): CloudTranscriptionProvider | undefined {
  return providers.find(provider => provider.envKey === envKey)
}

export function cloudTranscriptionProvidersFromCatalog(
  catalog: CloudTranscriptionCatalogResponse | null | undefined
): CloudTranscriptionProvider[] {
  if (!catalog?.providers?.length) {
    return CLOUD_TRANSCRIPTION_PROVIDERS
  }

  return CLOUD_TRANSCRIPTION_PROVIDERS.map(fallback => {
    const live = catalog.providers.find(provider => provider.id === fallback.id)

    if (!live) {
      return fallback
    }

    const models = live.models.map(model => model.id).filter(Boolean)

    return {
      catalogError: live.error ?? null,
      catalogSource: live.source,
      configured: live.configured,
      description: live.description || fallback.description,
      docsUrl: live.docsUrl || fallback.docsUrl,
      envKey: live.envKey || fallback.envKey,
      fetchedAt: live.fetchedAt ?? null,
      id: live.id,
      label: live.label || fallback.label,
      models: models.length > 0 ? models : fallback.models,
      recommendedModel: live.recommendedModel || models[0] || fallback.recommendedModel
    }
  })
}

export function transcriptionModelOptions(provider: CloudTranscriptionProvider, selectedModel?: string): string[] {
  const selected = selectedModel?.trim()
  const options = [...provider.models]

  if (selected && !options.includes(selected)) {
    options.unshift(selected)
  }

  return Array.from(new Set(options))
}
