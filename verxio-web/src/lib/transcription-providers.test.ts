import { describe, expect, it } from 'vitest'

import {
  type CloudTranscriptionCatalogResponse,
  cloudTranscriptionProviderById,
  cloudTranscriptionProvidersFromCatalog,
  transcriptionModelOptions
} from './transcription-providers'

describe('transcription provider catalog', () => {
  it('merges live provider models over fallback suggestions', () => {
    const catalog: CloudTranscriptionCatalogResponse = {
      cacheTtlSeconds: 86_400,
      providers: [
        {
          configured: true,
          description: 'Live OpenAI transcription',
          docsUrl: 'https://platform.openai.com/api-keys',
          envKey: 'VOICE_TOOLS_OPENAI_KEY',
          fetchedAt: '2026-07-14T00:00:00Z',
          id: 'openai',
          label: 'OpenAI',
          models: [
            { id: 'gpt-4o-mini-transcribe', source: 'provider' },
            { id: 'gpt-new-transcribe', source: 'provider' }
          ],
          recommendedModel: 'gpt-4o-mini-transcribe',
          source: 'provider'
        }
      ]
    }

    const providers = cloudTranscriptionProvidersFromCatalog(catalog)
    const openai = cloudTranscriptionProviderById('openai', providers)

    expect(openai?.catalogSource).toBe('provider')
    expect(openai?.models).toEqual(['gpt-4o-mini-transcribe', 'gpt-new-transcribe'])
    expect(openai?.recommendedModel).toBe('gpt-4o-mini-transcribe')
  })

  it('keeps a typed custom model in the suggestion list', () => {
    const providers = cloudTranscriptionProvidersFromCatalog(null)
    const groq = cloudTranscriptionProviderById('groq', providers)

    expect(groq).toBeTruthy()
    expect(groq?.envKey).toBe('GROQ_API_KEY')
    expect(transcriptionModelOptions(groq!, 'whisper-future')).toContain('whisper-future')
  })
})
