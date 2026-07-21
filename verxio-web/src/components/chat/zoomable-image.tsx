'use client'

import { type ComponentProps, useState } from 'react'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { Download } from '@/lib/icons'
import { downloadMediaFromCandidates, mediaFilename, startBrowserDownload } from '@/lib/media-download'
import { isVerxioDesktop } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

function isMissingIpcHandler(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  return message.includes("No handler registered for 'hermes:saveImageFromUrl'")
}

export interface ZoomableImageProps extends ComponentProps<'img'> {
  containerClassName?: string
  lightboxOpen?: boolean
  onLightboxOpenChange?: (open: boolean) => void
  slot?: string
}

export interface ImageActionCopy {
  downloadImage: string
  downloadStarted?: string
  imageDownloadFailed?: string
  restartToSaveImages?: string
  restartToUseSaveImage?: string
  savingImage: string
}

export async function downloadImageFromSrc(src: string, copy: ImageActionCopy): Promise<void> {
  await downloadImageFromCandidates([src], copy)
}

export async function downloadImageFromCandidates(candidates: readonly string[], copy: ImageActionCopy): Promise<void> {
  const unique = [...new Set(candidates.filter(Boolean))]

  if (!unique.length) {
    throw new Error('Nothing to download')
  }

  if (isVerxioDesktop() && window.hermesDesktop?.saveImageFromUrl) {
    for (const src of unique) {
      try {
        const saved = await window.hermesDesktop.saveImageFromUrl(src)

        if (saved) {
          notify({ kind: 'success', title: copy.downloadImage, message: mediaFilename(src) })

          return
        }
      } catch (error) {
        if (isMissingIpcHandler(error)) {
          try {
            const name = await downloadMediaFromCandidates(unique)
            notify({
              kind: 'info',
              title: copy.downloadStarted ?? copy.downloadImage,
              message: copy.restartToUseSaveImage ?? name
            })

            return
          } catch (fallbackError) {
            notifyError(fallbackError, copy.restartToSaveImages ?? copy.imageDownloadFailed ?? 'Download failed')

            return
          }
        }
      }
    }
  }

  const name = await downloadMediaFromCandidates(unique)
  notify({ kind: 'success', title: copy.downloadStarted ?? copy.downloadImage, message: name })
}

export function ZoomableImage({
  className,
  containerClassName,
  lightboxOpen,
  onLightboxOpenChange,
  src,
  alt,
  slot,
  ...props
}: ZoomableImageProps) {
  const { t } = useI18n()
  const copy = t.desktop
  const [saving, setSaving] = useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = lightboxOpen ?? uncontrolledOpen
  const setOpen = onLightboxOpenChange ?? setUncontrolledOpen
  const canOpen = Boolean(src)

  async function handleDownload() {
    if (!src || saving) {
      return
    }

    setSaving(true)

    try {
      await downloadImageFromSrc(src, copy)
    } catch (error) {
      if (isMissingIpcHandler(error)) {
        try {
          await startBrowserDownload(src)
          notify({
            kind: 'info',
            title: copy.downloadStarted,
            message: copy.restartToUseSaveImage
          })
        } catch (fallbackError) {
          notifyError(fallbackError, copy.restartToSaveImages)
        }

        return
      }

      notifyError(error, copy.imageDownloadFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <span
        className={cn('group/image relative inline-block max-w-full align-top', containerClassName)}
        data-slot={slot ?? 'aui_zoomable-image'}
      >
        <button
          className="contents"
          disabled={!canOpen}
          onClick={() => canOpen && setOpen(true)}
          title={canOpen ? copy.openImage : undefined}
          type="button"
        >
          <img alt={alt ?? ''} className={className} src={src} {...props} />
        </button>
        {src && (
          <ImageActionButton
            className="group-hover/image:opacity-100"
            copy={copy}
            onClick={handleDownload}
            saving={saving}
          />
        )}
      </span>
      {src && (
        <ImageLightbox
          alt={alt}
          copy={copy}
          onClick={handleDownload}
          onOpenChange={setOpen}
          open={open}
          saving={saving}
          src={src}
        />
      )}
    </>
  )
}

export function ImageLightbox({
  alt,
  copy,
  onClick,
  onOpenChange,
  open,
  saving,
  src
}: {
  alt?: string
  copy: ImageActionCopy
  onClick: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  saving: boolean
  src: string
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="block w-auto max-h-[calc(100vh-12rem)] max-w-[calc(100vw-12rem)] overflow-visible border-0 bg-transparent p-0 shadow-none"
        showCloseButton={false}
      >
        <div className="group/lightbox relative inline-block">
          <img
            alt={alt ?? ''}
            className="block max-h-[calc(100vh-12rem)] max-w-[calc(100vw-12rem)] cursor-zoom-out select-auto rounded-lg object-contain shadow-2xl"
            onClick={() => onOpenChange(false)}
            src={src}
          />
          <ImageActionButton
            className="group-hover/lightbox:opacity-100"
            copy={copy}
            onClick={onClick}
            saving={saving}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ImageActionButton({
  className,
  copy,
  onClick,
  saving
}: {
  className?: string
  copy: ImageActionCopy
  onClick: () => void
  saving: boolean
}) {
  return (
    <button
      aria-label={saving ? copy.savingImage : copy.downloadImage}
      className={cn(
        'absolute right-2 top-2 grid size-8 place-items-center rounded-full border border-border/70 bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:opacity-50',
        className
      )}
      disabled={saving}
      onClick={event => {
        event.stopPropagation()
        void onClick()
      }}
      title={saving ? copy.savingImage : copy.downloadImage}
      type="button"
    >
      <Download className={cn('size-4', saving && 'animate-pulse')} />
    </button>
  )
}
