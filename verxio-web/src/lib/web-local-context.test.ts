import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./web-local-fs', () => ({
  ensureWebLocalFsAccess: vi.fn(async () => true),
  isWebLocalPath: (path: string) => path.startsWith('verxio-local:'),
  readWebLocalDir: vi.fn(async () => ({ entries: [] })),
  readWebLocalFileText: vi.fn(async () => null)
}))

import { isGatewayStagedFileRef, preprocessWebLocalContextReferences } from './web-local-context'
import { ensureWebLocalFsAccess, readWebLocalDir, readWebLocalFileText } from './web-local-fs'

describe('web-local-context', () => {
  beforeEach(() => {
    vi.mocked(ensureWebLocalFsAccess).mockResolvedValue(true)
    vi.mocked(readWebLocalDir).mockResolvedValue({ entries: [] })
    vi.mocked(readWebLocalFileText).mockResolvedValue(null)
  })

  it('detects gateway-staged attachment paths', () => {
    expect(isGatewayStagedFileRef('.hermes/desktop-attachments/book.pdf')).toBe(true)
    expect(isGatewayStagedFileRef('desktop-attachments/book.pdf')).toBe(true)
    expect(isGatewayStagedFileRef('src/readme.md')).toBe(false)
    expect(isGatewayStagedFileRef('verxio-local:/verxio/notes.txt')).toBe(false)
  })

  it('leaves gateway-staged @file refs intact when a web-local cwd is set', async () => {
    const message =
      '@file:.hermes/desktop-attachments/_OceanofPDFcom_Think_like_a_billionaire__Become_a_billionaire_-_Scot_Anderson.pdf\n\nSummarize this PDF'

    const result = await preprocessWebLocalContextReferences(message, 'verxio-local:/verxio')

    expect(result).toContain(
      '@file:.hermes/desktop-attachments/_OceanofPDFcom_Think_like_a_billionaire__Become_a_billionaire_-_Scot_Anderson.pdf'
    )
    expect(result).toContain('Summarize this PDF')
    expect(result).not.toContain('file not found')
    expect(readWebLocalFileText).not.toHaveBeenCalled()
  })

  it('still expands project-local @file refs from the granted folder', async () => {
    vi.mocked(readWebLocalFileText).mockResolvedValue({
      path: 'verxio-local:/verxio/notes.txt',
      text: 'hello from notes',
      binary: false
    })

    const result = await preprocessWebLocalContextReferences('@file:notes.txt\n\nRead this', 'verxio-local:/verxio')

    expect(result).toContain('Attached Context')
    expect(result).toContain('hello from notes')
    expect(result.startsWith('@file:notes.txt')).toBe(false)
    expect(result).toContain('Read this')
  })

  it('still expands @folder refs from the granted folder', async () => {
    vi.mocked(readWebLocalDir).mockResolvedValue({
      entries: [{ name: 'skill.md', path: 'verxio-local:/verxio/skills/skill.md', isDirectory: false }]
    })
    vi.mocked(readWebLocalFileText).mockResolvedValue({
      path: 'verxio-local:/verxio/skills/skill.md',
      text: 'skill body',
      binary: false
    })

    const result = await preprocessWebLocalContextReferences('@folder:skills\n\nList this', 'verxio-local:/verxio')

    expect(result).toContain('Attached Context')
    expect(result).toContain('skills/')
    expect(result).toContain('skill.md')
  })
})
