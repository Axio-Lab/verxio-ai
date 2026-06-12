export function isVerxioWeb(): boolean {
  return typeof window !== 'undefined' && window.__VERXIO_WEB__ === true
}
