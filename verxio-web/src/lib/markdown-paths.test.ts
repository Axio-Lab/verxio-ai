import { describe, expect, it } from 'vitest'

import { anchorBareFileLinks } from './markdown-paths'
import { preprocessMarkdown } from './markdown-preprocess'

describe('anchorBareFileLinks', () => {
  it('turns workspace-relative deliverable links into paths the chat can open', () => {
    const source = [
      '- [Read the research report](artifacts/ai-opportunity-research/RESEARCH-REPORT.html)',
      '- [Download the Markdown report](artifacts/ai-opportunity-research/RESEARCH-REPORT.md)',
      '- [Download the research pack, including saved Tavily results](artifacts/ai-opportunity-research/RESEARCH-PACK.zip)'
    ].join('\n')

    expect(anchorBareFileLinks(source)).toBe(
      [
        '- [Read the research report](/workspace/artifacts/ai-opportunity-research/RESEARCH-REPORT.html)',
        '- [Download the Markdown report](/workspace/artifacts/ai-opportunity-research/RESEARCH-REPORT.md)',
        '- [Download the research pack, including saved Tavily results](/workspace/artifacts/ai-opportunity-research/RESEARCH-PACK.zip)'
      ].join('\n')
    )
  })

  it('leaves web links and already-rooted paths alone', () => {
    const source =
      '[NEAR](https://near.ai/blog/introducing-near-ai-agent-market) and [local](/workspace/artifacts/report.md)'

    expect(anchorBareFileLinks(source)).toBe(source)
  })

  it('survives markdown preprocessing', () => {
    const source = '[Read the research report](artifacts/ai-opportunity-research/RESEARCH-REPORT.html)'

    expect(preprocessMarkdown(source)).toContain(
      '[Read the research report](/workspace/artifacts/ai-opportunity-research/RESEARCH-REPORT.html)'
    )
  })
})
