import { describe, expect, it } from 'vitest'

import { currentPickerSelection } from './model-status-label'

describe('currentPickerSelection', () => {
  it('prefers scoped model options over stale store values', () => {
    expect(
      currentPickerSelection(
        false,
        { model: 'groq-whisper-large-v3', provider: 'groq' },
        {
          model: 'qwen3.6-plus',
          provider: 'alibaba'
        }
      )
    ).toEqual({
      model: 'qwen3.6-plus',
      provider: 'alibaba'
    })
  })
})
