import { useEffect, useState } from 'react'

import { MarkdownPreview } from '@/app/chat/right-rail/preview-file'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { Download } from '@/lib/icons'
import { startBrowserDownload } from '@/lib/media-download'
import { verxioApiUrl } from '@/lib/verxio-api'
import { notify, notifyError } from '@/store/notifications'

interface ArtifactTextPreviewDialogProps {
  artifactId: string
  label: string
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function ArtifactTextPreviewDialog({ artifactId, label, onOpenChange, open }: ArtifactTextPreviewDialogProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [asSource, setAsSource] = useState(false)

  const previewUrl = verxioApiUrl(`/api/artifacts/${encodeURIComponent(artifactId)}/preview`)
  const downloadUrl = verxioApiUrl(`/api/artifacts/${encodeURIComponent(artifactId)}/download`)
  const isMarkdown = /\.(md|markdown)$/i.test(label)

  useEffect(() => {
    if (!open) {
      return
    }

    let active = true

    setLoading(true)
    setError(null)
    setText('')
    setAsSource(false)

    void (async () => {
      try {
        const response = await fetch(previewUrl, { credentials: 'include' })

        if (!response.ok) {
          throw new Error(`Failed to load preview (${response.status})`)
        }

        const next = await response.text()

        if (active) {
          setText(next)
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [open, previewUrl])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[min(90dvh,52rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12">
          <DialogTitle className="truncate pr-2">{label}</DialogTitle>
          <DialogDescription className="sr-only">{t.artifacts.previewDescription}</DialogDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            {isMarkdown ? (
              <Button onClick={() => setAsSource(current => !current)} size="xs" type="button" variant="textStrong">
                {asSource ? t.preview.renderedPreview : t.preview.source}
              </Button>
            ) : null}
            <Button
              onClick={() => {
                void startBrowserDownload(downloadUrl)
                  .then(() => notify({ kind: 'success', message: label, title: t.artifacts.downloadStarted }))
                  .catch(err => notifyError(err, t.artifacts.downloadFailed))
              }}
              size="xs"
              type="button"
              variant="textStrong"
            >
              <Download className="size-3" />
              {t.artifacts.downloadAction}
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <PageLoader label={t.preview.loading} />
          ) : error ? (
            <div className="grid place-items-center px-6 py-10 text-center text-sm text-muted-foreground">{error}</div>
          ) : isMarkdown && !asSource ? (
            <MarkdownPreview text={text} />
          ) : (
            <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
              {text}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
