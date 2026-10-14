import { atom } from 'nanostores'

export const $tavusCallLive = atom(false)
export const $tavusCallOpen = atom(false)

export function openTavusCall() {
  $tavusCallOpen.set(true)
}

export function closeTavusCall() {
  $tavusCallOpen.set(false)
  $tavusCallLive.set(false)
}
