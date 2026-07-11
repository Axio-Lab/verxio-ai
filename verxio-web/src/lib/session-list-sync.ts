/**
 * Decide whether the sidebar session list should be re-fetched after a poll.
 *
 * Devices share one Hermes state.db but have no push channel, so we poll the
 * newest session id. When it changes, another device (or tab) created a chat.
 *
 * Also refresh when this client has an empty list but the poll found sessions —
 * that covers cold-start fetches that failed before the runtime was ready.
 */
export function shouldRefreshSessions(
  prevNewestId: string | null,
  currentNewestId: string | null,
  localSessionCount = 0
): boolean {
  if (currentNewestId !== null && localSessionCount === 0) {
    return true
  }

  return prevNewestId !== null && currentNewestId !== null && prevNewestId !== currentNewestId
}

export function isRetryableSessionListError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return /503|starting|timeout|timed out|failed to fetch|network|econnreset|socket/i.test(message)
}

export async function withSessionListRetries<T>(
  run: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number }
): Promise<T> {
  const attempts = options?.attempts ?? 5
  const delayMs = options?.delayMs ?? 1000
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run()
    } catch (error) {
      lastError = error

      if (!isRetryableSessionListError(error) || attempt === attempts - 1) {
        throw error
      }

      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }

  throw lastError
}
