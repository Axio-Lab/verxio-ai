import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { isWebLocalPath, pickBrowserLocalFolder, readWebLocalDir, WEB_LOCAL_PREFIX } from '@/lib/web-local-fs'
import { $webLocalFolderPicker, closeWebLocalFolderPicker } from '@/store/web-local-folder-picker'

function clean(path: string): string {
  return path.replace(/\/+$/, '') || `${WEB_LOCAL_PREFIX}/`
}

function parentDir(path: string): string {
  const value = clean(path)
  const rel = value.slice(WEB_LOCAL_PREFIX.length).replace(/^\/+/, '')
  const parts = rel.split('/').filter(Boolean)

  if (parts.length <= 1) {
    return value
  }

  parts.pop()

  return `${WEB_LOCAL_PREFIX}/${parts.join('/')}`
}

function pathName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

function isRootDir(path: string): boolean {
  const rel = clean(path).slice(WEB_LOCAL_PREFIX.length).replace(/^\/+/, '')

  return !rel.includes('/')
}

export function WebLocalFolderPicker() {
  const { t } = useI18n()
  const copy = t.rightSidebar
  const { open, request } = useStore($webLocalFolderPicker)
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !request) {
      return
    }

    setCurrentPath(isWebLocalPath(request.defaultPath) ? clean(request.defaultPath) : clean(`${WEB_LOCAL_PREFIX}/`))
  }, [open, request])

  useEffect(() => {
    if (!open || !currentPath) {
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    void readWebLocalDir(currentPath)
      .then(result => {
        if (!active) {
          return
        }

        if (result.error) {
          setError(result.error)
          setEntries([])

          return
        }

        setEntries(
          result.entries.filter(entry => entry.isDirectory).map(entry => ({ name: entry.name, path: entry.path }))
        )
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
          setEntries([])
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [currentPath, open])

  const crumbs = useMemo(() => {
    const rel = clean(currentPath).slice(WEB_LOCAL_PREFIX.length).replace(/^\/+/, '')
    const parts = rel.split('/').filter(Boolean)
    const out: Array<{ label: string; path: string }> = []

    if (parts.length === 0) {
      return out
    }

    let acc = WEB_LOCAL_PREFIX

    for (const part of parts) {
      acc = `${acc}/${part}`
      out.push({ label: part, path: acc })
    }

    return out
  }, [currentPath])

  const close = (path: string | null = null) => {
    closeWebLocalFolderPicker(path)
    setEntries([])
    setError(null)
  }

  const chooseAnotherFolder = async () => {
    const rootPath = await pickBrowserLocalFolder()

    close(rootPath)
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value) {
          close(null)
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <div className="border-b border-border/70 px-4 py-3">
          <DialogTitle className="text-sm">{request?.title || copy.folderPickerTitle}</DialogTitle>
          <DialogDescription className="mt-1 text-xs">{copy.folderPickerDescription}</DialogDescription>
        </div>

        <div className="flex min-h-[22rem] flex-col">
          <div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
            {crumbs.map((crumb, index) => (
              <button
                className={cn(
                  'rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground',
                  index === crumbs.length - 1 && 'text-foreground'
                )}
                key={crumb.path}
                onClick={() => setCurrentPath(crumb.path)}
                type="button"
              >
                {crumb.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <FolderRow
              disabled={isRootDir(currentPath)}
              name=".."
              onClick={() => setCurrentPath(parentDir(currentPath))}
            />
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Codicon name="loading" size="0.8rem" spinning />
                {copy.loadingFiles}
              </div>
            ) : error ? (
              <div className="px-2 py-3 text-xs text-destructive">{copy.unreadableBody(error)}</div>
            ) : entries.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">{copy.emptyBody}</div>
            ) : (
              entries.map(entry => (
                <FolderRow key={entry.path} name={pathName(entry.path)} onClick={() => setCurrentPath(entry.path)} />
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/70 px-4 py-3">
          <Button className="shrink-0 px-0" onClick={() => void chooseAnotherFolder()} size="sm" variant="link">
            {copy.folderPickerChooseAnother}
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">{currentPath}</div>
            <Button onClick={() => close(null)} size="sm" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button onClick={() => close(currentPath)} size="sm">
              {copy.folderPickerSelect}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FolderRow({ disabled = false, name, onClick }: { disabled?: boolean; name: string; onClick: () => void }) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-(--ui-text-secondary) hover:bg-(--ui-row-hover-background) hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Codicon name="folder" size="0.875rem" />
      <span className="min-w-0 truncate">{name}</span>
    </button>
  )
}
