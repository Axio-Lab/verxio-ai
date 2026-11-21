import { beforeEach, describe, expect, it, vi } from 'vitest'

import { persistString, storedString } from '@/lib/storage'

const dismissNotification = vi.fn()
const notify = vi.fn()

vi.mock('@/store/notifications', () => ({
  dismissNotification: (...args: unknown[]) => dismissNotification(...args),
  notify: (...args: unknown[]) => notify(...args)
}))

vi.mock('@/i18n', () => ({
  translateNow: (key: string) => key
}))

vi.mock('@/lib/storage', () => ({
  persistString: vi.fn(),
  storedString: vi.fn(() => null)
}))

describe('reportBackendContract', () => {
  beforeEach(() => {
    vi.resetModules()
    dismissNotification.mockReset()
    notify.mockReset()
  })

  it('toasts on desktop when contract is missing', async () => {
    const { reportBackendContract } = await import('./updates')

    reportBackendContract(undefined)

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'backend-contract-skew',
        kind: 'warning'
      })
    )
  })

  it('dismisses when desktop contract meets the requirement', async () => {
    const { reportBackendContract } = await import('./updates')

    reportBackendContract(2)

    expect(notify).not.toHaveBeenCalled()
    expect(dismissNotification).toHaveBeenCalledWith('backend-contract-skew')
  })
})

describe('maybeNotifyUpdateAvailable', () => {
  beforeEach(() => {
    vi.resetModules()
    dismissNotification.mockReset()
    notify.mockReset()
    vi.mocked(persistString).mockReset()
    vi.mocked(storedString).mockReset()
    vi.mocked(storedString).mockReturnValue(null)
  })

  it('opens the update dialog for a newer release', async () => {
    const { $updateOverlayOpen, maybeNotifyUpdateAvailable } = await import('./updates')

    maybeNotifyUpdateAvailable({ supported: true, behind: 1, targetSha: '0.0.2' })

    expect($updateOverlayOpen.get()).toBe(true)
    expect(notify).toHaveBeenCalled()
  })

  it('stays closed while the update prompt is snoozed', async () => {
    vi.mocked(storedString).mockReturnValue(String(Date.now() + 60_000))
    const { $updateOverlayOpen, maybeNotifyUpdateAvailable } = await import('./updates')

    maybeNotifyUpdateAvailable({ supported: true, behind: 1, targetSha: '0.0.2' })

    expect($updateOverlayOpen.get()).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps the update button available when a check reports progress', async () => {
    const progress = {
      at: Date.now(),
      error: null,
      message: 'Update 0.0.2 is available',
      percent: 30,
      stage: 'fetch' as const
    }

    let onProgress: (payload: typeof progress) => void = () => undefined

    const desktop = window as unknown as {
      hermesDesktop: {
        getVersion: () => Promise<null>
        updates: {
          apply: () => Promise<{ ok: boolean }>
          check: () => Promise<{ supported: boolean; behind: number; targetSha: string }>
          onProgress: (callback: (payload: typeof progress) => void) => () => void
        }
      }
    }

    desktop.hermesDesktop = {
      getVersion: async () => null,
      updates: {
        apply: async () => ({ ok: true }),
        check: async () => ({ supported: true, behind: 1, targetSha: '0.0.2' }),
        onProgress: callback => {
          onProgress = callback

          return () => undefined
        }
      }
    }

    const { $updateApply, $updateOverlayOpen, startUpdatePoller, stopUpdatePoller } = await import('./updates')

    startUpdatePoller()

    try {
      await vi.waitFor(() => expect($updateOverlayOpen.get()).toBe(true))
      onProgress(progress)
      expect($updateApply.get().applying).toBe(false)
      expect($updateOverlayOpen.get()).toBe(true)
    } finally {
      stopUpdatePoller()
    }
  })

  it('snoozes for a day when the user chooses maybe later', async () => {
    const { $updateOverlayOpen, postponeUpdate, setUpdateOverlayOpen } = await import('./updates')

    setUpdateOverlayOpen(true)
    postponeUpdate()

    expect($updateOverlayOpen.get()).toBe(false)
    expect(persistString).toHaveBeenCalledWith('hermes:update-toast-snooze-until', expect.any(String))
    expect(dismissNotification).toHaveBeenCalledWith('desktop-update-available')
  })
})
