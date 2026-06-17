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
import { CopyButton } from '@/components/ui/copy-button'
import { useI18n } from '@/i18n'
import { codiconForLanguage, isLikelyProseCodeBlock, sanitizeLanguageTag } from '@/lib/markdown-code'
import { isVerxioDesktop } from '@/lib/platform'

/**
 * Streamdown's code adapter renders header + body as inline siblings, so we
 * own the wrapping `<CodeCard>` here and neutralize the upstream
 * `data-streamdown="code-block"` chrome from styles.css. Anything that wants
 * a card-shaped code surface should compose `CodeCard*` directly.
 *
 * `react-shiki` full bundle so all `bundledLanguages` work; theme switches
 * follow the document `color-scheme` via `defaultColor="light-dark()"`.
 */
interface HermesSyntaxHighlighterProps extends SyntaxHighlighterProps {
  defer?: boolean
}

const SHIKI_THEME = { dark: 'github-dark-default', light: 'github-light-default' } as const

/**
 * `github-light-default` colors comments `#6e7781` (~4.2:1 against the code
 * card background) — borderline unreadable at our 11px code size, and worst of
 * all for shell snippets where a single `#` turns the rest of the line into one
 * long comment span. Remap light-mode comments to GitHub's darker muted gray
 * (`#57606a`, ~6.4:1). Dark mode (`#8b949e`, ~6.1:1) already reads fine, so we
 * leave it untouched. Keyed per theme name so the bump only applies in light.
 */
const SHIKI_COLOR_REPLACEMENTS: Record<string, Record<string, string>> = {
  'github-light-default': { '#6e7781': '#57606a' }
}

/** Oniguruma WASM can fail in Electron; JS RegExp engine keeps colored tokens working. */
const DESKTOP_SHIKI_ENGINE = createJavaScriptRegexEngine({ forgiving: true })

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

export const SyntaxHighlighter: FC<HermesSyntaxHighlighterProps> = ({
  components: { Pre },
  language,
  code,
  defer = false
}) => {
  const { t } = useI18n()
  const shikiEngine = useMemo(() => (isVerxioDesktop() ? DESKTOP_SHIKI_ENGINE : undefined), [])
  const trimmed = (code ?? '').replace(/^\n+/, '').trimEnd()

  // Streaming may hand us empty/incomplete fences — render nothing rather
  // than a transient empty card.
  if (!trimmed.trim()) {
    return null
  }

  if (isLikelyProseCodeBlock(language, trimmed)) {
    return <div className="aui-prose-fence whitespace-pre-wrap wrap-anywhere text-foreground">{trimmed}</div>
  }

  const cleanLanguage = sanitizeLanguageTag(language || '')
  const label = cleanLanguage && cleanLanguage !== 'unknown' ? cleanLanguage : ''

  const plainCode = (
    <code className="block whitespace-pre-wrap wrap-anywhere font-mono text-[0.8125rem] leading-relaxed text-foreground">
      {trimmed}
    </code>
  )

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
        <Pre className="aui-shiki m-0 overflow-x-auto bg-transparent p-0">
          {defer ? (
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
      </CodeCardBody>
    </CodeCard>
  )
}
