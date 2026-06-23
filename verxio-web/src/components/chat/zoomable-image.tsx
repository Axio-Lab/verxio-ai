'use client'

import { type ComponentProps, useState } from 'react'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { Download } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'

function imageFilename(src?: string): string {
  if (!src) {
    return 'image'
  }

  try {
    const { pathname } = new URL(src, window.location.href)

    return pathname.split('/').filter(Boolean).pop() || 'image'
  } catch {
    return src.split(/[\\/]/).filter(Boolean).pop() || 'image'
  }
}

function isMissingIpcHandler(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  return message.includes("No handler registered for 'hermes:saveImageFromUrl'")
}

async function startBrowserDownload(src: string) {
  const response = await fetch(src)

  if (!response.ok) {
    throw new Error(`Could not fetch image: ${response.status}`)
  }

  const blobUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = imageFilename(src)
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
}

export interface ZoomableImageProps extends ComponentProps<'img'> {
  containerClassName?: string
  slot?: string
}

export interface ImageActionCopy {
  downloadImage: string
  savingImage: string
}

export async function downloadImageFromSrc(src: string, copy: ImageActionCopy): Promise<void> {
  if (window.hermesDesktop?.saveImageFromUrl) {
    const saved = await window.hermesDesktop.saveImageFromUrl(src)

    if (saved) {
      notify({ kind: 'success', title: copy.downloadImage, message: imageFilename(src) })
    }

    return
  }

  await startBrowserDownload(src)
}

export function ZoomableImage({ className, containerClassName, src, alt, slot, ...props }: ZoomableImageProps) {
  const { t } = useI18n()
  const copy = t.desktop
  const [saving, setSaving] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
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
          onClick={() => canOpen && setLightboxOpen(true)}
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
          onOpenChange={setLightboxOpen}
          open={lightboxOpen}
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
