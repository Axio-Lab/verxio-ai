import { en } from './en'
import type { Locale, Translations } from './types'

export const TRANSLATIONS: Record<Locale, Translations> = {
  en,
  zh: en,
  'zh-hant': en,
  ja: en
}

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Translations>> = {
  zh: async () => (await import('./zh')).zh,
  'zh-hant': async () => (await import('./zh-hant')).zhHant,
  ja: async () => (await import('./ja')).ja
}

export async function loadTranslations(locale: Locale): Promise<Translations> {
  if (locale === 'en') {
    return en
  }

  const loaded = await loaders[locale]()
  TRANSLATIONS[locale] = loaded
  return loaded
}
