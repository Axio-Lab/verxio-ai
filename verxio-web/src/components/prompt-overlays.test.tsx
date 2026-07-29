import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'
import { $gateway } from '@/store/gateway'
import { clearFishAudioConfirmationRequest, setFishAudioConfirmationRequest } from '@/store/prompts'
import { setActiveSessionId } from '@/store/session'

import { FishAudioConfirmationDialog } from './prompt-overlays'

const request = {
  action: 'create' as const,
  actionLabel: 'Create private voice “Support”',
  confirmation: 'CONFIRM FISH VOICE CREATE A1B2C3D4',
  description: 'Confirm that this authorized recording may be used.',
  expiresAt: '2026-07-29T02:20:00Z',
  requestId: 'request-1',
  sessionId: 'session-1'
}

describe('FishAudioConfirmationDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    setActiveSessionId('session-1')
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    clearFishAudioConfirmationRequest()
    $gateway.set(null)
    setActiveSessionId(null)
    container.remove()
    vi.restoreAllMocks()
  })

  async function render(requestGateway: ReturnType<typeof vi.fn>) {
    $gateway.set({ request: requestGateway } as unknown as HermesGateway)
    setFishAudioConfirmationRequest(request)
    await act(async () => root.render(<FishAudioConfirmationDialog />))
  }

  it('shows server action and expiry, has Cancel, and has no close button', async () => {
    await render(vi.fn())

    expect(document.body.textContent).toContain(request.actionLabel)
    expect(document.body.textContent).toContain('Authorization expires')
    expect(Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Cancel')).toBe(true)
    expect(document.querySelector('button[aria-label="Close"]')).toBeNull()
  })

  it('cancels without submitting the one-time confirmation', async () => {
    const gatewayRequest = vi.fn().mockResolvedValue({ ok: true })
    await render(gatewayRequest)
    const cancel = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Cancel')

    await act(async () => cancel?.click())

    expect(gatewayRequest).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain(request.actionLabel)
  })

  it('sends a fail-closed refusal for a blocking server confirmation', async () => {
    const gatewayRequest = vi.fn().mockResolvedValue({ ok: true })
    $gateway.set({ request: gatewayRequest } as unknown as HermesGateway)
    setFishAudioConfirmationRequest({
      ...request,
      confirmation: { token: 'opaque-server-token' }
    })
    await act(async () => root.render(<FishAudioConfirmationDialog />))
    const cancel = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Cancel')

    await act(async () => cancel?.click())

    expect(gatewayRequest).toHaveBeenCalledWith('fishaudio.confirmation.respond', {
      approved: false,
      confirmation: { token: 'opaque-server-token' },
      request_id: request.requestId,
      session_id: request.sessionId
    })
  })

  it('centers a primary spinner while the action is running and surfaces errors', async () => {
    let reject!: (reason: Error) => void

    const gatewayRequest = vi.fn(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        })
    )

    await render(gatewayRequest)
    const confirm = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Confirm')

    await act(async () => confirm?.click())

    expect(gatewayRequest).toHaveBeenCalledWith('prompt.submit', {
      session_id: request.sessionId,
      text: request.confirmation
    })
    const status = document.querySelector('[role="status"]')
    expect(status?.className).toContain('items-center')
    expect(status?.querySelector('svg')?.getAttribute('class')).toContain('text-primary')

    await act(async () => reject(new Error('Confirmation expired')))

    expect(document.body.textContent).toContain('Confirmation expired')
    expect(document.querySelector('[role="status"]')).toBeNull()
  })
})
