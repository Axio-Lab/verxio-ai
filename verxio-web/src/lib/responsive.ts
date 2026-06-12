/** Matches `useIsMobile` / Tailwind `max-md` (below 768px). */
export const MOBILE_MEDIA_QUERY = '(max-width: 47.9375rem)'

export const PREVIEW_PANE_ID = 'preview'

export const MOBILE_OVERLAY_PANE_IDS = ['chat-sidebar', 'file-browser', PREVIEW_PANE_ID] as const

export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches
}
