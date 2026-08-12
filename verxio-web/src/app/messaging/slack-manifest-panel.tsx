import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { writeClipboardText } from '@/components/ui/copy-button'
import { getSlackManifest } from '@/hermes'
import { useI18n } from '@/i18n'
import { Check, Copy, ExternalLink } from '@/lib/icons'
import { notifyError } from '@/store/notifications'

const SLACK_APPS_URL = 'https://api.slack.com/apps'

export function SlackManifestPanel() {
  const { t } = useI18n()
  const m = t.messaging.slackManifest
  const [manifestJson, setManifestJson] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const generate = useCallback(async () => {
    setBusy(true)
    setCopied(false)

    try {
      const response = await getSlackManifest({ name: 'Verxio' })
      setManifestJson(response.json)
    } catch (err) {
      notifyError(err, m.generateFailed)
    } finally {
      setBusy(false)
    }
  }, [m.generateFailed])

  const copy = useCallback(async () => {
    if (!manifestJson) {
      return
    }

    try {
      await writeClipboardText(manifestJson)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      notifyError(err, m.copyFailed)
    }
  }, [manifestJson, m.copyFailed])

  return (
    <section>
      <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{m.title}</h4>
      <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {m.description}
      </p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-5 text-muted-foreground">
        {m.steps.map(step => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => void generate()} size="sm" variant="secondary">
          {busy ? m.generating : m.generate}
        </Button>
        <Button asChild size="sm" variant="textStrong">
          <a href={SLACK_APPS_URL} rel="noreferrer" target="_blank">
            {m.openSlackApps}
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>
      {manifestJson && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {m.manifestLabel}
            </p>
            <Button onClick={() => void copy()} size="sm" variant="ghost">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? m.copied : m.copy}
            </Button>
          </div>
          <textarea
            className="h-48 w-full resize-y rounded-lg border border-border/70 bg-background/60 p-3 font-mono text-[0.68rem] leading-5 text-foreground"
            readOnly
            value={manifestJson}
          />
        </div>
      )}
    </section>
  )
}
