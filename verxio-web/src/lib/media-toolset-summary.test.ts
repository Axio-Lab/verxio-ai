import { describe, expect, it } from 'vitest'

import { mediaToolsetActiveSummary } from './media-toolset-summary'

describe('mediaToolsetActiveSummary', () => {
  it('returns image provider and model from hermes config', () => {
    expect(
      mediaToolsetActiveSummary('image_gen', {
        image_gen: { provider: 'openai', model: 'gpt-image-2-medium' }
      })
    ).toEqual({ provider: 'openai', model: 'gpt-image-2-medium' })
  })

  it('returns video provider and model', () => {
    expect(
      mediaToolsetActiveSummary('video_gen', {
        video_gen: { provider: 'dashscope', model: 'happyhorse-1.1' }
      })
    ).toEqual({ provider: 'dashscope', model: 'happyhorse-1.1' })
  })

  it('returns null for non-media toolsets', () => {
    expect(mediaToolsetActiveSummary('memory', { image_gen: { provider: 'openai' } })).toBeNull()
  })
})
