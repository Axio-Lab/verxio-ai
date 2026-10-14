import type { MessagingApiServerResponse, MessagingPlatformInfo } from '@/types/hermes'

const DEFAULT_PORT = '8642'
const DEFAULT_MODEL = 'verxio'

function envValue(platform: MessagingPlatformInfo | undefined, key: string): string {
  const field = platform?.env_vars.find(item => item.key === key)
  const value = typeof field?.current_value === 'string' ? field.current_value.trim() : ''

  return value
}

export function messagingApiServerFromPlatforms(platforms: MessagingPlatformInfo[]): MessagingApiServerResponse {
  const platform = platforms.find(row => row.id === 'api_server')
  const configuredHost = envValue(platform, 'API_SERVER_HOST')
  const host = !configuredHost || configuredHost === '0.0.0.0' ? '127.0.0.1' : configuredHost
  const port = envValue(platform, 'API_SERVER_PORT') || DEFAULT_PORT
  const model = envValue(platform, 'API_SERVER_MODEL_NAME') || DEFAULT_MODEL
  const baseUrl = `http://${host}:${port}/v1`

  return {
    enabled: Boolean(platform?.enabled),
    base_url: baseUrl,
    model,
    example: [
      `curl ${baseUrl}/chat/completions \\`,
      '  -H "Authorization: Bearer $API_SERVER_KEY" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`
    ].join('\n')
  }
}
