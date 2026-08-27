/** Helpers for staging composer attachments that only exist in the browser. */

export function isAbsoluteFilesystemPath(path: string | undefined | null): boolean {
  const value = String(path || '').trim()

  if (!value) {
    return false
  }

  // Unix absolute or Windows drive path — gateway/desktop may resolve these.
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

/** Paths the web/desktop bridge can read for image preview + byte upload. */
export function isReadableAttachmentPath(path: string | undefined | null): boolean {
  const value = String(path || '').trim()

  return isAbsoluteFilesystemPath(value) || value.startsWith('verxio-local:')
}

export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')

  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

export async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mime = blob.type || 'application/octet-stream'

  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

export async function imageBytesFromFile(file: File): Promise<{ contentBase64: string; filename: string }> {
  const dataUrl = await readBlobAsDataUrl(file)
  const contentBase64 = base64FromDataUrl(dataUrl)
  const filename = file.name.split(/[\\/]/).filter(Boolean).pop() || 'image.png'

  if (!contentBase64) {
    throw new Error(`Could not read ${filename}`)
  }

  return { contentBase64, filename }
}

export async function fileDataUrlFromFile(file: File): Promise<{ dataUrl: string; filename: string }> {
  const dataUrl = await readBlobAsDataUrl(file)
  const filename = file.name.split(/[\\/]/).filter(Boolean).pop() || 'file'

  if (!dataUrl) {
    throw new Error(`Could not read ${filename}`)
  }

  return { dataUrl, filename }
}

export function pickBrowserFiles(options?: { accept?: string; multiple?: boolean }): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = Boolean(options?.multiple)

    if (options?.accept) {
      input.accept = options.accept
    }

    input.onchange = () => {
      resolve(Array.from(input.files ?? []))
    }

    input.oncancel = () => resolve([])
    input.click()
  })
}
