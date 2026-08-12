import { describe, expect, it } from 'vitest'

import {
  applyCloudTranscriptionConfig,
  configuredCloudTranscriptionProvider,
  selectedCloudTranscriptionModel,
  selectedCloudTranscriptionProvider
} from './transcription-config'
import { cloudTranscriptionProviderById, cloudTranscriptionProvidersFromCatalog } from './transcription-providers'

describe('transcription config', () => {
  it('does not treat a non-cloud stt provider as an already configured cloud provider', () => {
    const providers = cloudTranscriptionProvidersFromCatalog(null)
    const config = { stt: { provider: 'local' } }

    expect(selectedCloudTranscriptionProvider(config, providers).id).toBe('groq')
    expect(configuredCloudTranscriptionProvider(config, providers)).toBeUndefined()
  })

  it('writes Fish Audio provider and model settings for Hermes', () => {
    const providers = cloudTranscriptionProvidersFromCatalog(null)
    const fishaudio = cloudTranscriptionProviderById('fishaudio', providers)
    expect(fishaudio).toBeTruthy()

    const config = applyCloudTranscriptionConfig({}, fishaudio!, 'fish-audio-asr-beta')

    expect(config).toEqual({
      stt: {
        enabled: true,
        fishaudio: { model: 'fish-audio-asr-beta' },
        provider: 'fishaudio'
      }
    })
    expect(selectedCloudTranscriptionModel(config, fishaudio!)).toBe('fish-audio-asr-beta')
  })
})
