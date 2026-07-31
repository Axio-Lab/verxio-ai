import { isMediaToolset, type MediaToolset } from '@/lib/media-tool-options'
import { configValue } from '@/lib/transcription-config'
import type { HermesConfigRecord } from '@/types/hermes'

/** Human-facing provider + model line for media toolsets on the Toolsets list. */
export function mediaToolsetActiveSummary(
  toolsetName: string,
  config: HermesConfigRecord | null | undefined
): { provider: string; model: string | null } | null {
  if (!config || !isMediaToolset(toolsetName)) {
    return null
  }

  const toolset = toolsetName as MediaToolset

  if (toolset === 'image_gen') {
    const provider = String(configValue(config, 'image_gen.provider') ?? '').trim()
    const model = String(configValue(config, 'image_gen.model') ?? '').trim()

    return provider ? { provider, model: model || null } : null
  }

  if (toolset === 'video_gen') {
    const provider = String(configValue(config, 'video_gen.provider') ?? '').trim()
    const model = String(configValue(config, 'video_gen.model') ?? '').trim()

    return provider ? { provider, model: model || null } : null
  }

  const provider = String(configValue(config, 'tts.provider') ?? '').trim()
  const model = String(configValue(config, 'tts.dashscope.model') ?? '').trim()

  return provider ? { provider, model: model || null } : null
}
