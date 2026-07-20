import { ENUM_OPTIONS } from '@/app/settings/constants'

export type MediaToolset = 'image_gen' | 'video_gen' | 'tts'

export interface MediaOptionField {
  path: string
  label: string
  options: string[]
}

const DASHSCOPE_ALIASES = new Set(['dashscope', 'DashScope (Qwen Cloud)', 'DashScope'])
const GOOGLE_ALIASES = new Set(['google', 'Google', 'Google (Nano Banana)', 'Nano Banana', 'gemini'])
const OPENAI_ALIASES = new Set(['openai', 'OpenAI'])

export function isMediaToolset(toolset: string): toolset is MediaToolset {
  return toolset === 'image_gen' || toolset === 'video_gen' || toolset === 'tts'
}

export function isDashScopeProvider(providerName: string | null | undefined): boolean {
  const name = (providerName || '').trim()

  return DASHSCOPE_ALIASES.has(name) || name.toLowerCase().includes('dashscope')
}

export function isGoogleImageProvider(providerName: string | null | undefined): boolean {
  const name = (providerName || '').trim()
  const lower = name.toLowerCase()

  return (
    GOOGLE_ALIASES.has(name) ||
    lower.includes('nano banana') ||
    (lower.includes('google') && !lower.includes('gemini tts'))
  )
}

export function isOpenAIImageProvider(providerName: string | null | undefined): boolean {
  const name = (providerName || '').trim()

  return OPENAI_ALIASES.has(name) || name.toLowerCase() === 'openai'
}

/** Model/voice fields shown under Configure for media toolsets. */
export function mediaOptionFields(toolset: MediaToolset, providerName: string | null): MediaOptionField[] {
  if (toolset === 'image_gen') {
    if (isDashScopeProvider(providerName)) {
      return [
        {
          path: 'image_gen.model',
          label: 'Image model',
          options: ENUM_OPTIONS['image_gen.model'] ?? []
        }
      ]
    }

    if (isGoogleImageProvider(providerName)) {
      return [
        {
          path: 'image_gen.model',
          label: 'Image model',
          options: ENUM_OPTIONS['image_gen.google.model'] ?? ['nano-banana', 'nano-banana-pro']
        }
      ]
    }

    if (isOpenAIImageProvider(providerName)) {
      return [
        {
          path: 'image_gen.model',
          label: 'Image model',
          options: ENUM_OPTIONS['image_gen.openai.model'] ?? [
            'gpt-image-2-medium',
            'gpt-image-2-low',
            'gpt-image-2-high'
          ]
        }
      ]
    }

    return []
  }

  if (toolset === 'video_gen') {
    if (!isDashScopeProvider(providerName)) {
      return []
    }

    return [
      {
        path: 'video_gen.model',
        label: 'Video model family',
        options: ENUM_OPTIONS['video_gen.model'] ?? []
      }
    ]
  }

  if (!isDashScopeProvider(providerName)) {
    return []
  }

  return [
    {
      path: 'tts.dashscope.model',
      label: 'Speech model',
      options: ENUM_OPTIONS['tts.dashscope.model'] ?? []
    },
    {
      path: 'tts.dashscope.voice',
      label: 'Voice',
      options: ENUM_OPTIONS['tts.dashscope.voice'] ?? []
    }
  ]
}

export function defaultMediaModel(toolset: MediaToolset, providerName?: string | null): string {
  if (toolset === 'image_gen') {
    if (isGoogleImageProvider(providerName)) {
      return ENUM_OPTIONS['image_gen.google.model']?.[0] ?? 'nano-banana'
    }

    if (isOpenAIImageProvider(providerName)) {
      return ENUM_OPTIONS['image_gen.openai.model']?.[0] ?? 'gpt-image-2-medium'
    }

    return ENUM_OPTIONS['image_gen.model']?.[0] ?? 'qwen-image-2.0-pro'
  }

  if (toolset === 'video_gen') {
    return ENUM_OPTIONS['video_gen.model']?.[0] ?? 'happyhorse-1.1'
  }

  return ENUM_OPTIONS['tts.dashscope.model']?.[0] ?? 'qwen3-tts-flash'
}
