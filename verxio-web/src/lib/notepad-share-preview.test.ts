import { afterEach, describe, expect, it } from 'vitest'

import { notepadShareToken, rewriteLocalNotepadShareUrl } from './notepad-share-preview'

describe('notepad share preview urls', () => {
  const originalLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('reads the share token from a public link', () => {
    expect(notepadShareToken('http://127.0.0.1:8080/share/notepad/np_abc')).toBe('np_abc')
    expect(notepadShareToken('https://app.verxio.xyz/share/notepad/np_abc')).toBe('np_abc')
    expect(notepadShareToken('https://example.com/notes')).toBeNull()
  })

  it('points the local fallback host at the desktop app', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, origin: 'http://127.0.0.1:5180', protocol: 'http:' }
    })

    expect(rewriteLocalNotepadShareUrl('http://127.0.0.1:8080/share/notepad/np_abc')).toBe(
      'http://127.0.0.1:5180/share/notepad/np_abc'
    )
  })

  it('leaves a real public host unchanged', () => {
    expect(rewriteLocalNotepadShareUrl('https://app.verxio.xyz/share/notepad/np_abc')).toBe(
      'https://app.verxio.xyz/share/notepad/np_abc'
    )
  })
})
