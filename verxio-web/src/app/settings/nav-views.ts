/** Sub-views for Settings → Providers (Accounts vs API keys). */
export const PROVIDER_VIEWS = ['accounts', 'keys'] as const

export type ProviderView = (typeof PROVIDER_VIEWS)[number]

/** Sub-views for Settings → Tools & Keys. */
export const KEYS_VIEWS = ['tools', 'transcription', 'settings'] as const

export type KeysView = (typeof KEYS_VIEWS)[number]
