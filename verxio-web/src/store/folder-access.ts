import { atom } from 'nanostores'

export type FolderAccessPhase = 'consent' | 'unsupported'

interface FolderAccessState {
  open: boolean
  phase: FolderAccessPhase
  resolve: ((approved: boolean) => void) | null
}

export const $folderAccess = atom<FolderAccessState>({
  open: false,
  phase: 'consent',
  resolve: null
})

export function requestFolderAccessConsent(): Promise<boolean> {
  return new Promise(resolve => {
    $folderAccess.set({ open: true, phase: 'consent', resolve })
  })
}

export function showFolderAccessUnsupported(): Promise<void> {
  return new Promise(resolve => {
    $folderAccess.set({
      open: true,
      phase: 'unsupported',
      resolve: approved => {
        void approved
        resolve()
      }
    })
  })
}

export function closeFolderAccess(approved: boolean) {
  const { resolve } = $folderAccess.get()

  resolve?.(approved)
  $folderAccess.set({ open: false, phase: 'consent', resolve: null })
}
