'use client'

import type { SyntaxHighlighterProps } from '@assistant-ui/react-streamdown'
import { Component, type FC, type ReactNode, useMemo } from 'react'
import ShikiHighlighter from 'react-shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import {
  CodeCard,
  CodeCardBody,
  CodeCardHeader,
  CodeCardIcon,
  CodeCardSubtitle,
  CodeCardTitle
} from '@/components/chat/code-card'
import { ExpandableBlock } from '@/components/chat/expandable-block'
import { CopyButton } from '@/components/ui/copy-button'
import { useI18n } from '@/i18n'
import { codiconForLanguage, isLikelyProseCodeBlock, sanitizeLanguageTag } from '@/lib/markdown-code'
import { isVerxioDesktop } from '@/lib/platform'

interface HermesSyntaxHighlighterProps extends SyntaxHighlighterProps {
  defer?: boolean
}

const SHIKI_THEME = { dark: 'github-dark-default', light: 'github-light-default' } as const

const SHIKI_COLOR_REPLACEMENTS: Record<string, Record<string, string>> = {
  'github-light-default': { '#6e7781': '#57606a' }
}

const DESKTOP_SHIKI_ENGINE = createJavaScriptRegexEngine({ forgiving: true })

const MAX_HIGHLIGHT_CHARS = 150_000
const MAX_HIGHLIGHT_LINES = 3_000
const CHUNK_LINES = 200
const EST_LINE_PX = 16

export function exceedsHighlightBudget(code: string): boolean {
  if (code.length > MAX_HIGHLIGHT_CHARS) {
    return true
  }

  let lines = 1
  let idx = code.indexOf('\n')

  while (idx !== -1) {
    if ((lines += 1) > MAX_HIGHLIGHT_LINES) {
      return true
    }

    idx = code.indexOf('\n', idx + 1)
  }

  return false
}

interface CodeChunk {
  text: string
  lines: number
}

export function chunkByLines(code: string, perChunk: number): CodeChunk[] {
  const lines = code.split('\n')

  if (lines.length <= perChunk) {
    return [{ text: code, lines: lines.length }]
  }

  const chunks: CodeChunk[] = []

  for (let i = 0; i < lines.length; i += perChunk) {
    const slice = lines.slice(i, i + perChunk)
    chunks.push({ text: slice.join('\n'), lines: slice.length })
  }

  return chunks
}

class ShikiRenderBoundary extends Component<
  { children: ReactNode; code: string; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: { code: string }) {
    if (this.state.failed && prev.code !== this.props.code) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback
    }

    return this.props.children
  }
}

const PlainCode: FC<{ code: string }> = ({ code }) => {
  const chunks = useMemo(() => chunkByLines(code, CHUNK_LINES), [code])

  if (chunks.length === 1) {
    return (
      <code className="block whitespace-pre-wrap wrap-anywhere font-mono text-[0.8125rem] leading-relaxed text-foreground">
        {code}
      </code>
    )
  }

  return (
    <>
      {chunks.map((chunk, index) => (
        <code
          className="block whitespace-pre-wrap wrap-anywhere font-mono text-[0.8125rem] leading-relaxed text-foreground [content-visibility:auto]"
          key={index}
          style={{ containIntrinsicSize: `auto ${chunk.lines * EST_LINE_PX}px` }}
        >
          {chunk.text}
        </code>
      ))}
    </>
  )
}

export const SyntaxHighlighter: FC<HermesSyntaxHighlighterProps> = ({
  components: { Pre },
  language,
  code,
  defer = false
}) => {
  const { t } = useI18n()
  const shikiEngine = useMemo(() => (isVerxioDesktop() ? DESKTOP_SHIKI_ENGINE : undefined), [])
  const trimmed = (code ?? '').replace(/^\n+/, '').trimEnd()

  if (!trimmed.trim()) {
    return null
  }

  if (isLikelyProseCodeBlock(language, trimmed)) {
    return <div className="aui-prose-fence whitespace-pre-wrap wrap-anywhere text-foreground">{trimmed}</div>
  }

  const cleanLanguage = sanitizeLanguageTag(language || '')
  const label = cleanLanguage && cleanLanguage !== 'unknown' ? cleanLanguage : ''
  const plain = defer || exceedsHighlightBudget(trimmed)

  const plainCode = <PlainCode code={trimmed} />

  return (
    <CodeCard data-streaming={defer ? 'true' : undefined}>
      <CodeCardHeader>
        <CodeCardTitle>
          <CodeCardIcon name={codiconForLanguage(label)} />
          {t.assistant.tool.code}
          {label && <CodeCardSubtitle> · {label}</CodeCardSubtitle>}
        </CodeCardTitle>
        <CopyButton
          appearance="inline"
          className="-my-1 -mr-1 h-5 px-1 opacity-55 hover:opacity-100"
          iconClassName="size-2.5"
          label={t.assistant.tool.copyCode}
          showLabel={false}
          text={trimmed}
        />
      </CodeCardHeader>
      <CodeCardBody>
        <ExpandableBlock>
          <Pre className="aui-shiki m-0 overflow-hidden bg-transparent p-0">
            {plain ? (
              plainCode
            ) : (
              <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
                <div aria-hidden className="invisible">
                  {plainCode}
                </div>
                <ShikiRenderBoundary code={trimmed} fallback={plainCode}>
                  <ShikiHighlighter
                    addDefaultStyles={false}
                    as="div"
                    className="min-w-0 bg-transparent font-mono text-[0.8125rem] leading-relaxed [&_code]:whitespace-pre-wrap [&_code]:wrap-anywhere"
                    colorReplacements={SHIKI_COLOR_REPLACEMENTS}
                    defaultColor="light-dark()"
                    delay={0}
                    engine={shikiEngine}
                    language={language || 'text'}
                    showLanguage={false}
                    theme={SHIKI_THEME}
                  >
                    {trimmed}
                  </ShikiHighlighter>
                </ShikiRenderBoundary>
              </div>
            )}
          </Pre>
        </ExpandableBlock>
      </CodeCardBody>
    </CodeCard>
  )
}
