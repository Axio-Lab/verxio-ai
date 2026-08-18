import { atom } from 'nanostores'

export interface WebLocalFolderPickerRequest {
  defaultPath: string
  title: string
}

interface WebLocalFolderPickerState {
  open: boolean
  request: WebLocalFolderPickerRequest | null
  resolve: ((path: string | null) => void) | null
}

export const $webLocalFolderPicker = atom<WebLocalFolderPickerState>({
  open: false,
  request: null,
  resolve: null
})

export function requestWebLocalFolderPicker(request: WebLocalFolderPickerRequest): Promise<string | null> {
  return new Promise(resolve => {
    $webLocalFolderPicker.set({ open: true, request, resolve })
  })
}

export function closeWebLocalFolderPicker(path: string | null) {
  const { resolve } = $webLocalFolderPicker.get()

  resolve?.(path)
  $webLocalFolderPicker.set({ open: false, request: null, resolve: null })
}
