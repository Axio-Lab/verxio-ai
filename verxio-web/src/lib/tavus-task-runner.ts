import type { TavusTask } from '@/lib/verxio-api'

export interface TavusTaskDeps {
  claim: () => Promise<TavusTask | null>
  fileInCalls: (sessionId: string) => void
  finish: (taskId: string, status: 'done' | 'failed', resultText: string, hermesSessionId: string) => Promise<void>
  notify: (message: string) => void
  speak: (conversationId: string, text: string) => Promise<void>
  submit: (instruction: string) => Promise<{ resultText: string; sessionId: string }>
}

/** Speak a finished Hermes result only while the in-app call is still up. */
export function shouldSpeakResult(callLive: boolean): boolean {
  return callLive
}

export async function runNextTavusTask(
  deps: TavusTaskDeps,
  callLive: boolean | (() => boolean)
): Promise<'idle' | 'chat' | 'spoken'> {
  const task = await deps.claim()

  if (!task) {
    return 'idle'
  }

  try {
    const submitted = await deps.submit(task.instruction)
    deps.fileInCalls(submitted.sessionId)
    await deps.finish(task.id, 'done', submitted.resultText, submitted.sessionId)
    deps.notify(submitted.resultText || task.instruction)
    const live = typeof callLive === 'function' ? callLive() : callLive

    if (shouldSpeakResult(live) && task.conversationId) {
      await deps.speak(task.conversationId, submitted.resultText || 'Done. The details are in Verxio.')

      return 'spoken'
    }

    return 'chat'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The task failed.'
    await deps.finish(task.id, 'failed', message, '')
    deps.notify(message)

    return 'chat'
  }
}
