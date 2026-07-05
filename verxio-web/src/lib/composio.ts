/** MCP server name written by verxio-api Composio bridge — not user-managed in Settings → MCP. */
export const COMPOSIO_MCP_SERVER_NAME = 'composio'

export function isComposioMcpServer(name: string): boolean {
  return name === COMPOSIO_MCP_SERVER_NAME
}
