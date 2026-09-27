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

    expect(selectedCloudTranscriptionProvider(config, providers).id).toBe('local')
    expect(configuredCloudTranscriptionProvider(config, providers)?.id).toBe('local')
  })

  it('writes the on-device Whisper model without a cloud provider', () => {
    const providers = cloudTranscriptionProvidersFromCatalog(null)
    const local = cloudTranscriptionProviderById('local', providers)
    expect(local).toBeTruthy()

    const config = applyCloudTranscriptionConfig({}, local!, 'small')

    expect(config).toEqual({
      stt: {
        enabled: true,
        local: { model: 'small' },
        provider: 'local'
      }
    })
    expect(selectedCloudTranscriptionModel(config, local!)).toBe('small')
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
