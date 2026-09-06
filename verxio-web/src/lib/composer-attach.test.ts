import { describe, expect, it } from 'vitest'

import {
  base64FromDataUrl,
  fileDataUrlFromFile,
  imageBytesFromFile,
  isAbsoluteFilesystemPath,
  isReadableAttachmentPath
} from './composer-attach'

describe('composer-attach helpers', () => {
  it('detects absolute filesystem paths only', () => {
    expect(isAbsoluteFilesystemPath('/tmp/photo.jpg')).toBe(true)
    expect(isAbsoluteFilesystemPath('C:\\Users\\a\\photo.jpg')).toBe(true)
    expect(isAbsoluteFilesystemPath('IMG_9225.jpg')).toBe(false)
    expect(isAbsoluteFilesystemPath('images/upload_1.jpg')).toBe(false)
    expect(isAbsoluteFilesystemPath('')).toBe(false)
    expect(isAbsoluteFilesystemPath('verxio-local:/verxio/photo.jpg')).toBe(false)
  })

  it('accepts web-local paths as readable attachment sources', () => {
    expect(isReadableAttachmentPath('/tmp/photo.jpg')).toBe(true)
    expect(isReadableAttachmentPath('verxio-local:/verxio/photo.jpg')).toBe(true)
    expect(isReadableAttachmentPath('IMG_9225.jpg')).toBe(false)
  })

  it('strips data-url prefixes for base64 payloads', () => {
    expect(base64FromDataUrl('data:image/png;base64,abc123')).toBe('abc123')
    expect(base64FromDataUrl('abc123')).toBe('abc123')
  })

  it('reads image bytes from a browser File', async () => {
    const file = new File([Uint8Array.from([1, 2, 3, 4])], 'IMG_9225.jpg', { type: 'image/jpeg' })
    const payload = await imageBytesFromFile(file)

    expect(payload.filename).toBe('IMG_9225.jpg')
    expect(payload.contentBase64.length).toBeGreaterThan(0)
  })

  it('reads a file data URL for file.attach uploads', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const payload = await fileDataUrlFromFile(file)

    expect(payload.filename).toBe('notes.txt')
    expect(payload.dataUrl.startsWith('data:')).toBe(true)
  })
})
