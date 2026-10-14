import { describe, expect, it, vi } from 'vitest'

import { runNextTavusTask, shouldSpeakResult } from './tavus-task-runner'

describe('tavus task handoff', () => {
  it('claims one task and speaks only while the call is live', async () => {
    const finish = vi.fn(async () => undefined)
    const speak = vi.fn(async () => undefined)

    const task = {
      conversationId: 'c_1',
      hermesSessionId: '',
      id: 'task_1',
      instruction: 'Add a row to Airtable',
      resultText: '',
      status: 'pending'
    }

    const deps = {
      claim: vi.fn(async () => task),
      fileInCalls: vi.fn(),
      finish,
      notify: vi.fn(),
      speak,
      submit: vi.fn(async () => ({ resultText: 'Added the row.', sessionId: 's_1' }))
    }

    expect(shouldSpeakResult(true)).toBe(true)
    expect(shouldSpeakResult(false)).toBe(false)
    await expect(runNextTavusTask(deps, true)).resolves.toBe('spoken')
    expect(deps.claim).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledWith('c_1', 'Added the row.')

    speak.mockClear()
    await expect(runNextTavusTask(deps, false)).resolves.toBe('chat')
    expect(speak).not.toHaveBeenCalled()
  })
})
