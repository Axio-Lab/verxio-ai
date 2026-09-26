const PROVIDER_SETUP_ERROR_RE =
  /No (?:inference|Hermes|Verxio) provider(?: is)? configured|no_provider_configured|OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|set an API key|Codex auth|auth is missing|re-authenticate|setup\.status reports configured credentials, but runtime resolution still failed/i

const DESKTOP_AUTH_HINTS: [RegExp, string][] = [
  [/Run `hermes auth` to re-authenticate\.?/gi, 'Reconnect the account in Settings.'],
  [/Run `hermes auth` to authenticate\.?/gi, 'Connect the account in Settings.'],
  [/Run `hermes model` to re-authenticate\.?/gi, 'Reconnect the account in Settings.'],
  [/Run 'hermes model' to choose a provider and model/gi, 'Choose a provider in Settings'],
  [/run `hermes model` to configure(?: \([^)]+\))?/gi, 'connect the account in Settings'],
  [/Re-authenticate with: hermes auth add nous/gi, 'Reconnect Nous in Settings.'],
  [/~\/\.hermes\/\.env/g, 'Settings']
]

export function rewriteDesktopAuthMessage(message: string): string {
  return DESKTOP_AUTH_HINTS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), message)
}

export function isProviderSetupErrorMessage(message: null | string | undefined): boolean {
  const text = message?.trim()

  if (!text) {
    return false
  }

  return PROVIDER_SETUP_ERROR_RE.test(text)
}
