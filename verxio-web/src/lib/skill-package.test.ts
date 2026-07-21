import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { extractSkillPackage } from './skill-package'

describe('extractSkillPackage', () => {
  it('extracts SKILL.md from a zip with custom category and support files', async () => {
    const zip = new JSZip()
    zip.file(
      'my-pack/SKILL.md',
      `---
name: cafe-ops
description: Run cafe open checklist.
---

# Cafe Ops
`
    )
    zip.file('my-pack/references/checklist.md', '# Checklist\n')
    zip.file('my-pack/assets/logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]))

    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'cafe.zip', { type: 'application/zip' })
    const extracted = await extractSkillPackage(file)

    expect(extracted.name).toBe('cafe-ops')
    expect(extracted.category).toBe('custom')
    expect(extracted.content).toContain('Cafe Ops')
    expect(extracted.files).toEqual([{ path: 'references/checklist.md', content: '# Checklist\n' }])
    expect(extracted.skippedBinary).toEqual(['assets/logo.png'])
  })

  it('extracts a bare SKILL.md file as custom', async () => {
    const file = new File(
      [
        `---
name: notes
description: Capture notes.
---

Body
`
      ],
      'SKILL.md',
      { type: 'text/markdown' }
    )

    const extracted = await extractSkillPackage(file)
    expect(extracted.name).toBe('notes')
    expect(extracted.category).toBe('custom')
    expect(extracted.files).toEqual([])
  })
})
