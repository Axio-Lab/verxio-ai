import { describe, expect, it } from 'vitest'

import { parseCommandDispatch } from './chat-runtime'

describe('parseCommandDispatch', () => {
  it('accepts prefill responses from slash command dispatch', () => {
    expect(
      parseCommandDispatch({
        type: 'prefill',
        message: 'revise this prompt',
        notice: 'Loaded previous prompt'
      })
    ).toEqual({
      type: 'prefill',
      message: 'revise this prompt',
      notice: 'Loaded previous prompt'
    })
  })
})
