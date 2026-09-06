import { describe, expect, it } from 'vitest'

import { type DroppedFile, partitionDroppedFiles } from './use-composer-actions'

const osDrop = (path: string): DroppedFile => ({ file: new File(['x'], path.split('/').pop() || 'f'), path })
const inAppRef = (path: string, extra: Partial<DroppedFile> = {}): DroppedFile => ({ path, ...extra })

describe('partitionDroppedFiles', () => {
  it('routes File-bearing OS drops to osDrops and path-only in-app drags to inAppRefs', () => {
    const finderPdf = osDrop('/Users/me/Downloads/book.pdf')
    const projectFile = inAppRef('src/index.ts')

    const { inAppRefs, osDrops } = partitionDroppedFiles([finderPdf, projectFile])

    expect(osDrops).toEqual([finderPdf])
    expect(inAppRefs).toEqual([projectFile])
  })

  it('treats an OS screenshot drop as an upload target', () => {
    const screenshot = osDrop('/var/folders/tmp/Screenshot.png')

    const { inAppRefs, osDrops } = partitionDroppedFiles([screenshot])

    expect(osDrops).toEqual([screenshot])
    expect(inAppRefs).toEqual([])
  })

  it('keeps gutter line-range drags inline', () => {
    const lineRef = inAppRef('src/app.ts', { line: 10, lineEnd: 20 })

    const { inAppRefs, osDrops } = partitionDroppedFiles([lineRef])

    expect(osDrops).toEqual([])
    expect(inAppRefs).toEqual([lineRef])
  })

  it('returns empty partitions for an empty input', () => {
    expect(partitionDroppedFiles([])).toEqual({ inAppRefs: [], osDrops: [] })
  })
})
