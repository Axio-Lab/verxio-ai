import { beforeEach, describe, expect, it, vi } from 'vitest'

const dismissNotification = vi.fn()
const notify = vi.fn()
const isVerxioWeb = vi.fn(() => false)

vi.mock('@/store/notifications', () => ({
  dismissNotification: (...args: unknown[]) => dismissNotification(...args),
  notify: (...args: unknown[]) => notify(...args)
}))

vi.mock('@/lib/platform', () => ({
  isVerxioWeb: () => isVerxioWeb()
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
    isVerxioWeb.mockReturnValue(false)
  })

  it('does not toast on Verxio Web even when contract is missing', async () => {
    isVerxioWeb.mockReturnValue(true)
    const { reportBackendContract } = await import('./updates')

    reportBackendContract(undefined)

    expect(notify).not.toHaveBeenCalled()
    expect(dismissNotification).toHaveBeenCalledWith('backend-contract-skew')
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
