import { verxioApiEnabled } from '@/lib/verxio-api'
import type { OAuthProvider } from '@/types/hermes'

/** Hermes subscription portal — Verxio Hosted uses DashScope instead. */
const VERXIO_EXCLUDED_OAUTH_PROVIDER_IDS = new Set(['nous'])

export function oauthProvidersForProduct(providers: OAuthProvider[]): OAuthProvider[] {
  if (!verxioApiEnabled()) {
    return providers
  }

  return providers.filter(provider => !VERXIO_EXCLUDED_OAUTH_PROVIDER_IDS.has(provider.id))
}

export function usesVerxioConnectAccountPicker(): boolean {
  return verxioApiEnabled()
}
