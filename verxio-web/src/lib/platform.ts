export function isVerxioWeb(): boolean {
  return typeof window !== 'undefined' && window.__VERXIO_WEB__ === true
}

export function isVerxioDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.hermesDesktop) && !isVerxioWeb()
}
