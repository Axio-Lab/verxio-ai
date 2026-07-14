import { describe, expect, it } from 'vitest'

import { configuredCloudTranscriptionProvider, selectedCloudTranscriptionProvider } from './transcription-config'
import { cloudTranscriptionProvidersFromCatalog } from './transcription-providers'

describe('transcription config', () => {
  it('does not treat a non-cloud stt provider as an already configured cloud provider', () => {
    const providers = cloudTranscriptionProvidersFromCatalog(null)
    const config = { stt: { provider: 'local' } }

    expect(selectedCloudTranscriptionProvider(config, providers).id).toBe('groq')
    expect(configuredCloudTranscriptionProvider(config, providers)).toBeUndefined()
  })
})
