import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { FolderOpen } from '@/lib/icons'
import { $folderAccess, closeFolderAccess } from '@/store/folder-access'

export function FolderAccessDialog() {
  const { t } = useI18n()
  const copy = t.folderAccess
  const { open, phase } = useStore($folderAccess)

  const unsupported = phase === 'unsupported'

  return (
    <Dialog
      onOpenChange={value => {
        if (!value) {
          closeFolderAccess(false)
        }
      }}
      open={open}
    >
      <DialogContent
        className="max-w-md gap-0 overflow-hidden border-(--stroke-nous) p-0 shadow-nous"
        showCloseButton={false}
      >
        <div className="flex flex-col items-center gap-3 border-b border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) px-6 pb-5 pt-6">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderOpen className="size-5" />
          </div>
          <DialogHeader className="items-center space-y-1.5 text-center">
            <DialogTitle className="text-base">{unsupported ? copy.unsupportedTitle : copy.title}</DialogTitle>
            <DialogDescription className="text-pretty text-[0.8125rem] leading-relaxed">
              {unsupported ? copy.unsupportedBody : copy.body}
            </DialogDescription>
          </DialogHeader>
        </div>

        <DialogFooter className="gap-2 bg-(--ui-chat-bubble-background) px-6 py-4 sm:justify-end">
          <Button onClick={() => closeFolderAccess(false)} type="button" variant="ghost">
            {unsupported ? copy.dismiss : copy.cancel}
          </Button>
          {!unsupported ? (
            <Button onClick={() => closeFolderAccess(true)} type="button">
              {copy.allow}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
