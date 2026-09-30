export function isVerxioDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.hermesDesktop)
}
