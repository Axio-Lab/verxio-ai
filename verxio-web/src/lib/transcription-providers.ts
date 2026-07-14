export type CloudTranscriptionProviderId = 'elevenlabs' | 'groq' | 'mistral' | 'openai' | 'xai'

export interface CloudTranscriptionProvider {
  description: string
  docsUrl: string
  envKey: string
  id: CloudTranscriptionProviderId
  label: string
  models: string[]
  recommendedModel: string
}

export const CLOUD_TRANSCRIPTION_PROVIDERS: CloudTranscriptionProvider[] = [
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

export const CLOUD_TRANSCRIPTION_ENV_KEYS = CLOUD_TRANSCRIPTION_PROVIDERS.map(provider => provider.envKey)

export function cloudTranscriptionProviderById(id: string | null | undefined): CloudTranscriptionProvider | undefined {
  return CLOUD_TRANSCRIPTION_PROVIDERS.find(provider => provider.id === id)
}

export function cloudTranscriptionProviderForEnvKey(envKey: string): CloudTranscriptionProvider | undefined {
  return CLOUD_TRANSCRIPTION_PROVIDERS.find(provider => provider.envKey === envKey)
}
