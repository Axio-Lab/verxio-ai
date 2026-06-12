import type { HermesReadDirEntry, HermesReadDirResult, HermesReadFileTextResult } from '@/global'
import { requestFolderAccessConsent, showFolderAccessUnsupported } from '@/store/folder-access'

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface FileSystemDirectoryHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}

/** Virtual path prefix for folders granted via the browser File System Access API. */
export const WEB_LOCAL_PREFIX = 'verxio-local:'

/** localStorage key for the last browser-granted folder (see install-web-bridge). */
export const WEB_LOCAL_STORAGE_KEY = 'verxio.default.project.dir'

const IDB_NAME = 'verxio-web-fs'
const IDB_STORE = 'handles'
const ROOT_KEY = 'root'

/** Read-only — avoids Chrome's "Save changes / edit files" permission dialog. */
const WEB_LOCAL_ACCESS_MODE = 'read' as const

let cachedRoot: FileSystemDirectoryHandle | null = null

export function isWebLocalPath(path: string): boolean {
  return path.startsWith(WEB_LOCAL_PREFIX)
}

export function webLocalRootPath(name: string): string {
  return `${WEB_LOCAL_PREFIX}/${name}`
}

export function getStoredWebLocalRoot(): string | null {
  if (typeof localStorage === 'undefined') {
    return null
  }

  const saved = localStorage.getItem(WEB_LOCAL_STORAGE_KEY)?.trim()

  return saved && isWebLocalPath(saved) ? saved : null
}

/** Resolve the browser-granted folder even when the gateway has replaced $currentCwd with a server path. */
export function resolveWebLocalWorkspaceCwd(currentCwd?: string | null): string | null {
  const trimmed = currentCwd?.trim()

  if (trimmed && isWebLocalPath(trimmed)) {
    return trimmed
  }

  return getStoredWebLocalRoot()
}

export function supportsBrowserFolderPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

function parseWebLocalPath(path: string): string[] {
  const rel = path.slice(WEB_LOCAL_PREFIX.length).replace(/^\/+/, '')

  return rel ? rel.split('/').filter(Boolean) : []
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)

    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE)
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function persistRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  cachedRoot = handle

  const db = await openDb()

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')

    tx.objectStore(IDB_STORE).put(handle, ROOT_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  db.close()
}

async function loadStoredRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedRoot) {
    return cachedRoot
  }

  try {
    const db = await openDb()

    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(ROOT_KEY)

      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null)
      req.onerror = () => reject(req.error)
    })

    db.close()

    return handle
  } catch {
    return null
  }
}

/** Passive restore — only returns a handle when permission is already granted. */
export async function restoreRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadStoredRootHandle()

  if (!handle) {
    return null
  }

  const perm = await handle.queryPermission({ mode: WEB_LOCAL_ACCESS_MODE })

  if (perm !== 'granted') {
    return null
  }

  cachedRoot = handle

  return handle
}

async function resolveHandleForPath(path: string): Promise<FileSystemDirectoryHandle | null> {
  const root = cachedRoot ?? (await restoreRootHandle())

  if (!root) {
    return null
  }

  const segments = parseWebLocalPath(path)

  if (segments.length === 0) {
    return root
  }

  let current = root
  const startIdx = segments[0] === root.name ? 1 : 0

  for (let i = startIdx; i < segments.length; i += 1) {
    try {
      current = await current.getDirectoryHandle(segments[i]!)
    } catch {
      return null
    }
  }

  return current
}

/** Browser-native folder picker — grants read access to a folder on the user's PC. */
export async function pickBrowserLocalFolder(): Promise<string | null> {
  if (!supportsBrowserFolderPicker()) {
    await showFolderAccessUnsupported()

    return null
  }

  const approved = await requestFolderAccessConsent()

  if (!approved) {
    return null
  }

  try {
    const handle = await window.showDirectoryPicker!({ mode: WEB_LOCAL_ACCESS_MODE })

    await persistRootHandle(handle)

    return webLocalRootPath(handle.name)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null
    }

    throw error
  }
}

export async function readWebLocalDir(dirPath: string): Promise<HermesReadDirResult> {
  const handle = await resolveHandleForPath(dirPath)

  if (!handle) {
    return {
      entries: [],
      error: 'folder-access-revoked'
    }
  }

  const root = cachedRoot ?? (await restoreRootHandle())
  const basePath = dirPath.replace(/\/+$/, '') || (root ? webLocalRootPath(root.name).replace(/\/+$/, '') : dirPath)

  const entries: HermesReadDirEntry[] = []

  try {
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith('.')) {
        continue
      }

      entries.push({
        name,
        path: `${basePath}/${name}`,
        isDirectory: entry.kind === 'directory'
      })
    }

    entries.sort(
      (left, right) => -Number(right.isDirectory) + Number(left.isDirectory) || left.name.localeCompare(right.name)
    )

    return { entries }
  } catch {
    return { entries: [], error: 'read-error' }
  }
}

export async function readWebLocalFileText(filePath: string): Promise<HermesReadFileTextResult | null> {
  if (!isWebLocalPath(filePath)) {
    return null
  }

  const normalized = filePath.replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  const parentPath = slash === -1 ? normalized : normalized.slice(0, slash)
  const fileName = slash === -1 ? '' : normalized.slice(slash + 1)

  if (!fileName) {
    return null
  }

  const parent = await resolveHandleForPath(parentPath || normalized)

  if (!parent) {
    return null
  }

  try {
    const fileHandle = await parent.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    const text = await file.text()

    return {
      path: filePath,
      text,
      binary: false
    }
  } catch {
    try {
      const fileHandle = await parent.getFileHandle(fileName)
      const file = await fileHandle.getFile()

      return {
        path: filePath,
        text: '',
        binary: true
      }
    } catch {
      return null
    }
  }
}
