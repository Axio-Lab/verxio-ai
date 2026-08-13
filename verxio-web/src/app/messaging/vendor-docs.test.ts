import { describe, expect, it } from 'vitest'

import { isVendorSetupUrl } from './vendor-docs'

describe('isVendorSetupUrl', () => {
  it('keeps vendor credential docs', () => {
    expect(isVendorSetupUrl('https://core.telegram.org/bots/features#botfather')).toBe(true)
    expect(isVendorSetupUrl('https://discord.com/developers/applications')).toBe(true)
    expect(isVendorSetupUrl('https://developers.facebook.com/docs/whatsapp/cloud-api/get-started')).toBe(true)
  })

  it('hides empty and Hermes setup guides', () => {
    expect(isVendorSetupUrl('')).toBe(false)
    expect(isVendorSetupUrl(null)).toBe(false)
    expect(isVendorSetupUrl('https://hermes-agent.nousresearch.com/docs/user-guide/messaging/')).toBe(false)
    expect(isVendorSetupUrl('https://setup.hermes-agent.nousresearch.com')).toBe(false)
  })
})
