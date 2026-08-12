/** Marketing site (verxio.xyz). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.verxio.xyz').replace(/\/$/, '')

/** Product app (app.verxio.xyz) — auth + dashboard live here. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.verxio.xyz').replace(/\/$/, '')

export function appPath(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`

  return `${APP_URL}${normalized}`
}
