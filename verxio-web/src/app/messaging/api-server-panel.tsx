import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { writeClipboardText } from '@/components/ui/copy-button'
import { getMessagingApiServer } from '@/hermes'
import { useI18n } from '@/i18n'
import { Copy } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import type { MessagingPlatformInfo } from '@/types/hermes'

function SectionTitle({ children }: { children: string }) {
  return <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</h4>
}

export function ApiServerPanel({ platform }: { platform: MessagingPlatformInfo }) {
  const { t } = useI18n()
  const copy = t.messaging.apiServer
  const [baseUrl, setBaseUrl] = useState('')
  const [example, setExample] = useState('')

  useEffect(() => {
    let cancelled = false
    let attempt = 0
    let retryTimer: number | undefined

    const load = async () => {
      try {
        const result = await getMessagingApiServer()

        if (cancelled) {
          return
        }

        setBaseUrl(result.base_url)
        setExample(result.example)
      } catch (err) {
        attempt += 1
        if (!cancelled && attempt < 5) {
          retryTimer = window.setTimeout(() => {
            void load()
          }, 600 * attempt)
          return
        }
        if (!cancelled) {
          notifyError(err, copy.loadFailed)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      if (retryTimer) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [copy.loadFailed, platform.enabled])

  async function handleCopy(label: string, value: string) {
    try {
      await writeClipboardText(value)
      notify({ kind: 'success', title: copy.copiedTitle(label), message: copy.copiedMessage })
    } catch {
      notify({ kind: 'error', title: copy.copyFailed, message: copy.copyFailed })
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle>{copy.title}</SectionTitle>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {copy.description}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{copy.keyHint}</p>
      </section>

      {baseUrl ? (
        <section className="rounded-md border border-border/60 bg-muted/30 px-3 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.baseUrlLabel}
              </p>
              <p className="wrap-anywhere font-mono text-xs">{baseUrl}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.authHint}</p>
            </div>
            <Button
              className="size-8 shrink-0"
              onClick={() => void handleCopy(copy.baseUrlLabel, baseUrl)}
              title={copy.copyUrl}
              variant="ghost"
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          {example ? (
            <pre className="mt-3 overflow-x-auto rounded-md bg-background/80 p-2 font-mono text-[0.7rem] leading-5 text-muted-foreground">
              {example}
            </pre>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
