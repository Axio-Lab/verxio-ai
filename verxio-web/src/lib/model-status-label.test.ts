import { describe, expect, it } from 'vitest'

import { currentPickerSelection } from './model-status-label'

describe('currentPickerSelection', () => {
  it('prefers scoped model options over stale store values when no session is active', () => {
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

  it('prefers the live session store over hosted options defaults', () => {
    expect(
      currentPickerSelection(
        true,
        { model: 'gemini-3.1-pro-preview', provider: 'gemini' },
        {
          model: 'gemini-flash-lite-latest',
          provider: 'gemini'
        }
      )
    ).toEqual({
      model: 'gemini-3.1-pro-preview',
      provider: 'gemini'
    })
  })
})
