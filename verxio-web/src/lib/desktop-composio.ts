import { isVerxioDesktop } from '@/lib/platform'
import { createComposioMcpSession, createDeviceToken, verxioApiBaseUrl } from '@/lib/verxio-api'

/** Give the local desktop agent the same Composio Tool Router the browser runtime uses. */
export async function syncDesktopComposio(): Promise<void> {
  if (!isVerxioDesktop()) {
    return
  }

  const desktop = window.hermesDesktop

  if (!desktop?.applyCloudConfig) {
    return
  }

  const session = await createComposioMcpSession()
  const status = await desktop.agentBridgeStatus?.()
  const runtimeToken = status?.hasRuntimeToken ? '' : (await createDeviceToken()).token

  await desktop.applyCloudConfig({
    agentPrompt: session.agentPrompt || '',
    apiKey: session.mcpApiKey || '',
    apiUrl: verxioApiBaseUrl(),
    enabled: session.enabled,
    mcpUrl: session.mcpUrl || '',
    prompt: session.prompt || '',
    publicWebUrl: session.publicWebUrl || '',
    runtimeToken,
    soulPrompt: session.soulPrompt || ''
  })

  try {
    await desktop.api({
      method: 'POST',
      path: '/api/mcp/reload',
      scope: 'local',
      timeoutMs: 60_000
    })
  } catch {
    // The next agent start reads the bridge from disk.
  }
}
