import { useCallback } from 'react'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { useI18n } from '@/i18n'
import { attachmentId, contextPath, pathLabel } from '@/lib/chat-runtime'
import { isAbsoluteFilesystemPath, pickBrowserFiles, readBlobAsDataUrl } from '@/lib/composer-attach'
import { fishAudioAttachmentRef, uploadFishAudioAttachment } from '@/lib/fishaudio-session'
import { isVerxioWeb } from '@/lib/platform'
import {
  addComposerAttachment,
  type ComposerAttachment,
  removeComposerAttachment,
  setComposerTerminalSelection
} from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'

import type { ImageDetachResponse } from '../../types'

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico)$/i
const AUDIO_EXTENSION_PATTERN = /\.(aac|flac|m4a|mp3|mp4|ogg|opus|wav|webm)$/i

const BLOB_MIME_EXTENSION: Record<string, string> = {
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
  'image/x-icon': '.ico'
}

function blobExtension(blob: Blob): string {
  const mime = blob.type.split(';')[0]?.trim().toLowerCase()

  return (mime && BLOB_MIME_EXTENSION[mime]) || '.png'
}

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSION_PATTERN.test(filePath)
}

function isAudioPath(filePath: string): boolean {
  return AUDIO_EXTENSION_PATTERN.test(filePath)
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || isAudioPath(file.name)
}

export interface DroppedFile {
  /** Browser-native File handle. Absent for in-app drags (e.g. project tree). */
  file?: File
  /** Absolute filesystem path. Empty when an OS drop didn't carry one. */
  path: string
  /** True if the entry is a directory. Currently only set by in-app drags. */
  isDirectory?: boolean
  /** First line number for in-app line-ref drags (source view gutter). */
  line?: number
  /** Last line number for line-range drags (`line..lineEnd` inclusive). */
  lineEnd?: number
}

/** MIME emitted by in-app drag sources (project tree, gutter line numbers).
 * Payload is JSON `{ path; isDirectory?; line?; lineEnd? }[]`. */
export const HERMES_PATHS_MIME = 'application/x-hermes-paths'

/**
 * Eagerly resolve files from a drop event into [File?, path, isDirectory?]
 * triples. Internal Verxio sources (e.g. the project tree) ride on a custom
 * MIME and produce path-only entries; OS drops produce File-bearing entries.
 *
 * Must be called synchronously from inside the drop handler — `DataTransfer`
 * items are detached as soon as the handler returns, and `webUtils.getPathForFile`
 * also requires the original (non-cloned) File reference.
 */
export function extractDroppedFiles(transfer: DataTransfer): DroppedFile[] {
  const result: DroppedFile[] = []
  const seenPaths = new Set<string>()
  const seenFiles = new Set<File>()
  const getPath = window.hermesDesktop?.getPathForFile

  // In-app drags first — they carry richer metadata (isDirectory) than the
  // File-based fallback can provide, and produce no overlapping native files.
  try {
    const internalRaw = transfer.getData(HERMES_PATHS_MIME)

    if (internalRaw) {
      const parsed = JSON.parse(internalRaw) as {
        path?: unknown
        isDirectory?: unknown
        line?: unknown
        lineEnd?: unknown
      }[]

      const positiveInt = (value: unknown) => (typeof value === 'number' && value > 0 ? Math.floor(value) : undefined)

      for (const entry of parsed) {
        if (!entry || typeof entry.path !== 'string' || !entry.path) {
          continue
        }

        const line = positiveInt(entry.line)
        const rawEnd = positiveInt(entry.lineEnd)
        const lineEnd = line && rawEnd && rawEnd > line ? rawEnd : undefined
        const dedupKey = line ? `${entry.path}:${line}-${lineEnd ?? line}` : entry.path

        if (seenPaths.has(dedupKey)) {
          continue
        }

        seenPaths.add(dedupKey)
        result.push({ isDirectory: entry.isDirectory === true, line, lineEnd, path: entry.path })
      }
    }
  } catch {
    // Malformed payload — fall through to native files.
  }

  const fileList = transfer.files

  if (fileList) {
    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList.item(i)

      if (!file || seenFiles.has(file)) {
        continue
      }

      seenFiles.add(file)
      let path = ''

      if (getPath) {
        try {
          path = getPath(file) || ''
        } catch {
          path = ''
        }
      }

      if (path && seenPaths.has(path)) {
        continue
      }

      if (path) {
        seenPaths.add(path)
      }

      result.push({ file, path })
    }
  }

  const items = transfer.items

  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]

      if (!item || item.kind !== 'file') {
        continue
      }

      const file = item.getAsFile()

      if (!file || seenFiles.has(file)) {
        continue
      }

      seenFiles.add(file)
      let path = ''

      if (getPath) {
        try {
          path = getPath(file) || ''
        } catch {
          path = ''
        }
      }

      if (path && seenPaths.has(path)) {
        continue
      }

      if (path) {
        seenPaths.add(path)
      }

      result.push({ file, path })
    }
  }

  return result
}

interface ComposerActionsOptions {
  activeSessionId: string | null
  currentCwd: string
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

/** Add to the main composer and focus it. All sidebar/picker/drop attach paths funnel through here. */
const attachToMain = (attachment: ComposerAttachment) => {
  addComposerAttachment(attachment)
  requestComposerFocus('main')
}

export function useComposerActions({ activeSessionId, currentCwd, requestGateway }: ComposerActionsOptions) {
  const { t } = useI18n()
  const copy = t.desktop

  const addTextToDraft = useCallback((text: string) => {
    requestComposerInsert(text, { mode: 'block' })
  }, [])

  const addTerminalSelectionAttachment = useCallback((text: string, label = 'selection') => {
    const trimmed = text.trim()
    const normalizedLabel = label.trim() || 'selection'
    const refText = `@terminal:${formatRefValue(normalizedLabel)}`

    if (!trimmed) {
      return
    }

    setComposerTerminalSelection(normalizedLabel, trimmed)
    requestComposerInsert(refText, { mode: 'inline' })
  }, [])

  const addContextRefAttachment = useCallback((refText: string, label?: string, detail?: string) => {
    const kind: ComposerAttachment['kind'] = refText.startsWith('@folder:')
      ? 'folder'
      : refText.startsWith('@url:')
        ? 'url'
        : 'file'

    attachToMain({
      id: attachmentId(kind, refText),
      kind,
      label: label || refText.replace(/^@(file|folder|url):/, ''),
      detail,
      refText
    })
  }, [])

  const attachContextFilePath = useCallback(
    (filePath: string) => {
      if (!filePath) {
        return false
      }

      const rel = contextPath(filePath, currentCwd)

      attachToMain({
        id: attachmentId('file', rel),
        kind: 'file',
        label: pathLabel(filePath),
        detail: rel,
        refText: `@file:${formatRefValue(rel)}`,
        path: filePath
      })

      return true
    },
    [currentCwd]
  )

  const attachImagePath = useCallback(
    async (filePath: string) => {
      if (!filePath) {
        return false
      }

      // Bare browser filenames are not gateway-visible. Require a real path or
      // a File blob (attachImageFile) so submit can call image.attach_bytes.
      if (!isAbsoluteFilesystemPath(filePath)) {
        return false
      }

      const baseAttachment: ComposerAttachment = {
        id: attachmentId('image', filePath),
        kind: 'image',
        label: pathLabel(filePath),
        detail: filePath,
        path: filePath
      }

      attachToMain(baseAttachment)

      try {
        const previewUrl = await window.hermesDesktop?.readFileDataUrl(filePath)

        if (previewUrl) {
          addComposerAttachment({ ...baseAttachment, previewUrl })
        }

        return true
      } catch (err) {
        notifyError(err, copy.imagePreviewFailed)

        return true
      }
    },
    [copy.imagePreviewFailed]
  )

  const attachImageFile = useCallback(async (file: File) => {
    if (!file.size || !(file.type.startsWith('image/') || isImagePath(file.name))) {
      return false
    }

    const safeName = file.name.split(/[\\/]/).filter(Boolean).pop() || 'image.png'
    const id = attachmentId('image', `${safeName}:${file.size}:${file.lastModified}`)

    let previewUrl: string | undefined

    try {
      previewUrl = await readBlobAsDataUrl(file)
    } catch {
      previewUrl = undefined
    }

    attachToMain({
      id,
      kind: 'image',
      label: safeName,
      detail: safeName,
      path: safeName,
      previewUrl,
      // Keep the browser File until prompt submit uploads via image.attach_bytes.
      uploadFile: file
    })

    return true
  }, [])

  const attachImageBlob = useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        return false
      }

      if (blob.type && !blob.type.startsWith('image/')) {
        return false
      }

      // Web (and remote) can't write a temp file the gateway can see. Stage the
      // blob as a File and upload bytes on submit.
      if (isVerxioWeb() || blob instanceof File) {
        const file =
          blob instanceof File
            ? blob
            : new File([blob], `paste${blobExtension(blob)}`, {
                type: blob.type || 'image/png'
              })

        return attachImageFile(file)
      }

      try {
        const buffer = await blob.arrayBuffer()
        const data = new Uint8Array(buffer)
        const savedPath = await window.hermesDesktop?.saveImageBuffer(data, blobExtension(blob))

        if (!savedPath) {
          const file = new File([blob], `paste${blobExtension(blob)}`, {
            type: blob.type || 'image/png'
          })

          return attachImageFile(file)
        }

        return attachImagePath(savedPath)
      } catch (err) {
        notifyError(err, copy.imageAttachFailed)

        return false
      }
    },
    [attachImageFile, attachImagePath, copy.imageAttachFailed]
  )

  const attachAudioFile = useCallback(
    async (file: File) => {
      if (!file.size || !isAudioFile(file)) {
        return false
      }

      const safeName = file.name.split(/[\\/]/).filter(Boolean).pop() || t.composer.audio
      const id = attachmentId('audio', `${safeName}:${file.size}:${file.lastModified}`)

      const pending: ComposerAttachment = {
        id,
        kind: 'audio',
        label: safeName,
        uploadFile: file
      }

      attachToMain(pending)

      if (!activeSessionId) {
        return true
      }

      try {
        const uploaded = await uploadFishAudioAttachment(file, activeSessionId, requestGateway)
        addComposerAttachment({
          ...pending,
          attachedSessionId: activeSessionId,
          digest: uploaded.digest,
          expiresAt: uploaded.expires_at,
          refText: fishAudioAttachmentRef(uploaded.handle),
          uploadFile: undefined
        })

        return true
      } catch (err) {
        removeComposerAttachment(id)
        notifyError(err, t.composer.audioAttachFailed)

        return false
      }
    },
    [activeSessionId, requestGateway, t.composer.audio, t.composer.audioAttachFailed]
  )

  const attachBrowserFile = useCallback(
    async (file: File) => {
      if (!file.size) {
        return false
      }

      if (file.type.startsWith('image/') || isImagePath(file.name)) {
        return attachImageFile(file)
      }

      if (isAudioFile(file)) {
        return attachAudioFile(file)
      }

      const safeName = file.name.split(/[\\/]/).filter(Boolean).pop() || 'file'
      const id = attachmentId('file', `${safeName}:${file.size}:${file.lastModified}`)

      attachToMain({
        id,
        kind: 'file',
        label: safeName,
        detail: safeName,
        path: safeName,
        refText: `@file:${formatRefValue(safeName)}`,
        uploadFile: file
      })

      return true
    },
    [attachAudioFile, attachImageFile]
  )

  const pickContextPaths = useCallback(
    async (kind: 'file' | 'folder') => {
      // Web file pickers only give File blobs (no gateway-visible path). Keep
      // the File so submit can upload via file.attach / image.attach_bytes.
      if (kind === 'file' && isVerxioWeb()) {
        const files = await pickBrowserFiles({ multiple: true })

        for (const file of files) {
          await attachBrowserFile(file)
        }

        return
      }

      const paths = await window.hermesDesktop?.selectPaths({
        title: kind === 'file' ? 'Add files as context' : 'Add folders as context',
        defaultPath: currentCwd || undefined,
        directories: kind === 'folder'
      })

      if (!paths?.length) {
        return
      }

      for (const path of paths) {
        if (kind === 'file' && !isAbsoluteFilesystemPath(path) && isVerxioWeb()) {
          continue
        }

        const rel = contextPath(path, currentCwd)

        attachToMain({
          id: attachmentId(kind, rel),
          kind,
          label: pathLabel(path),
          detail: rel,
          refText: `@${kind}:${formatRefValue(rel)}`,
          path
        })
      }
    },
    [attachBrowserFile, currentCwd]
  )

  const pickAudio = useCallback(() => {
    const input = document.createElement('input')
    input.accept = 'audio/*,.m4a,.mp3,.wav,.ogg,.opus,.flac,.aac,.webm'
    input.multiple = true
    input.type = 'file'

    input.onchange = () => {
      const files = Array.from(input.files ?? [])

      for (const file of files) {
        void attachAudioFile(file)
      }
    }

    input.click()
  }, [attachAudioFile])

  const pickImages = useCallback(async () => {
    if (isVerxioWeb()) {
      const files = await pickBrowserFiles({
        accept: 'image/*,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff',
        multiple: true
      })

      for (const file of files) {
        await attachImageFile(file)
      }

      return
    }

    const paths = await window.hermesDesktop?.selectPaths({
      title: copy.attachImages,
      defaultPath: currentCwd || undefined,
      filters: [
        {
          name: t.composer.images,
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff']
        }
      ]
    })

    if (!paths?.length) {
      return
    }

    for (const path of paths) {
      await attachImagePath(path)
    }
  }, [attachImageFile, attachImagePath, copy.attachImages, currentCwd, t.composer.images])

  const pasteClipboardImage = useCallback(async () => {
    try {
      const path = await window.hermesDesktop?.saveClipboardImage()

      if (!path) {
        notify({
          kind: 'warning',
          title: copy.clipboard,
          message: copy.noClipboardImage
        })

        return
      }

      await attachImagePath(path)
    } catch (err) {
      notifyError(err, copy.clipboardPasteFailed)
    }
  }, [attachImagePath, copy.clipboard, copy.clipboardPasteFailed, copy.noClipboardImage])

  const attachContextFolderPath = useCallback(
    (folderPath: string) => {
      if (!folderPath) {
        return false
      }

      const rel = contextPath(folderPath, currentCwd)

      attachToMain({
        id: attachmentId('folder', rel),
        kind: 'folder',
        label: pathLabel(folderPath),
        detail: rel,
        refText: `@folder:${formatRefValue(rel)}`,
        path: folderPath
      })

      return true
    },
    [currentCwd]
  )

  const attachDroppedItems = useCallback(
    async (candidates: DroppedFile[]) => {
      if (candidates.length === 0) {
        return false
      }

      let attached = false
      let lastFailure: string | null = null

      for (const candidate of candidates) {
        const { file, isDirectory, path: knownPath } = candidate

        // Path-only entry (in-app drag from the file browser tree, etc.).
        if (!file) {
          if (isDirectory) {
            if (knownPath && attachContextFolderPath(knownPath)) {
              attached = true

              continue
            }

            lastFailure = `Could not attach folder ${knownPath || ''}`

            continue
          }

          if (knownPath && isImagePath(knownPath)) {
            if (await attachImagePath(knownPath)) {
              attached = true

              continue
            }

            lastFailure = `Could not attach ${knownPath}`

            continue
          }

          if (knownPath && isAudioPath(knownPath)) {
            lastFailure = t.composer.audioNeedsUpload

            continue
          }

          if (knownPath && attachContextFilePath(knownPath)) {
            attached = true

            continue
          }

          lastFailure = `Could not attach ${knownPath || 'file'}`

          continue
        }

        const fallbackPath =
          !knownPath && window.hermesDesktop?.getPathForFile ? window.hermesDesktop.getPathForFile(file) : ''

        // Ignore name-only "paths" from the web bridge — they aren't gateway-visible.
        const filePath =
          (knownPath && isAbsoluteFilesystemPath(knownPath) && knownPath) ||
          (fallbackPath && isAbsoluteFilesystemPath(fallbackPath) && fallbackPath) ||
          ''

        const isImage = file.type.startsWith('image/') || isImagePath(file.name) || (filePath && isImagePath(filePath))

        if (isAudioFile(file)) {
          if (await attachAudioFile(file)) {
            attached = true

            continue
          }

          lastFailure = `Could not attach ${file.name || 'audio'}`

          continue
        }

        if (isImage) {
          // Prefer the browser File so submit can image.attach_bytes. Only use
          // path-based attach when we have a real absolute filesystem path.
          if ((await attachImageFile(file)) || (filePath && (await attachImagePath(filePath)))) {
            attached = true

            continue
          }

          lastFailure = `Could not attach ${file.name || 'image'}`

          continue
        }

        if (await attachBrowserFile(file)) {
          attached = true

          continue
        }

        if (filePath && attachContextFilePath(filePath)) {
          attached = true

          continue
        }

        lastFailure = `Could not attach ${file.name || 'file'}`
      }

      if (!attached && lastFailure) {
        notify({ kind: 'warning', title: copy.dropFiles, message: lastFailure })
      }

      return attached
    },
    [
      attachAudioFile,
      attachBrowserFile,
      attachContextFilePath,
      attachContextFolderPath,
      attachImageFile,
      attachImagePath,
      copy.dropFiles,
      t.composer.audioNeedsUpload
    ]
  )

  const removeAttachment = useCallback(
    async (id: string) => {
      const removed = removeComposerAttachment(id)

      if (
        removed?.kind === 'image' &&
        removed.path &&
        activeSessionId &&
        removed.attachedSessionId &&
        removed.attachedSessionId === activeSessionId
      ) {
        await requestGateway<ImageDetachResponse>('image.detach', {
          session_id: activeSessionId,
          path: removed.path
        }).catch(() => undefined)
      }
    },
    [activeSessionId, requestGateway]
  )

  return {
    addContextRefAttachment,
    addTerminalSelectionAttachment,
    addTextToDraft,
    attachAudioFile,
    attachContextFilePath,
    attachContextFolderPath,
    attachDroppedItems,
    attachBrowserFile,
    attachImageBlob,
    attachImageFile,
    attachImagePath,
    pasteClipboardImage,
    pickAudio,
    pickContextPaths,
    pickImages,
    removeAttachment
  }
}
