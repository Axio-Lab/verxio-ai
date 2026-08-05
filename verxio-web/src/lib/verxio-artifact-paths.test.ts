import { describe, expect, it } from 'vitest'

import { extractWorkspaceArtifactPaths, workspaceArtifactRelativePath } from './verxio-artifact-paths'

describe('verxio artifact paths', () => {
  it('extracts generated workspace artifact paths from assistant text', () => {
    expect(
      extractWorkspaceArtifactPaths('Done. Image saved to /workspace/artifacts/man_in_pool_nano_banana.png (885 KB).')
    ).toEqual(['/workspace/artifacts/man_in_pool_nano_banana.png'])
  })

  it('keeps timestamp prefixes that look like numeric extensions', () => {
    expect(extractWorkspaceArtifactPaths('Fixed.\n\n/workspace/artifacts/0.00-verxio.png\n')).toEqual([
      '/workspace/artifacts/0.00-verxio.png'
    ])
    expect(extractWorkspaceArtifactPaths('/workspace/artifacts/1.30-pov-hook.png')).toEqual([
      '/workspace/artifacts/1.30-pov-hook.png'
    ])
  })

  it('normalizes supported artifact path forms', () => {
    expect(workspaceArtifactRelativePath('/workspace/artifacts/report.csv')).toBe('report.csv')
    expect(workspaceArtifactRelativePath('/artifacts/report.csv')).toBe('report.csv')
    expect(workspaceArtifactRelativePath('artifacts/report.csv')).toBe('report.csv')
    expect(workspaceArtifactRelativePath('file:///workspace/artifacts/report.csv')).toBe('report.csv')
  })
})
