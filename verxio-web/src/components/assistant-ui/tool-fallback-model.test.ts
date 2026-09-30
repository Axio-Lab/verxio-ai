import { describe, expect, it } from 'vitest'

import { buildToolView, displayVerxioCommand, displayVerxioTerminalOutput } from './tool-fallback-model'

describe('displayVerxioCommand', () => {
  it('shows the desktop CLI as Verxio', () => {
    expect(displayVerxioCommand('hermes tools list')).toBe('verxio tools list')
    expect(displayVerxioCommand('hermes mcp list')).toBe('verxio mcp list')
    expect(displayVerxioCommand('hermes status --all')).toBe('verxio status --all')
    expect(displayVerxioCommand('hermes mcp test composio')).toBe('verxio mcp test composio')
    expect(displayVerxioCommand("hermes chat -q 'health check'")).toBe("verxio chat -q 'health check'")
    expect(displayVerxioCommand('/usr/bin/hermes mcp list')).toBe('verxio mcp list')
  })

  it('leaves paths and other commands alone', () => {
    expect(displayVerxioCommand('ls hermes-agent')).toBe('ls hermes-agent')
    expect(displayVerxioCommand('echo hello')).toBe('echo hello')
  })
})

describe('displayVerxioTerminalOutput', () => {
  it('renames the status banner', () => {
    expect(displayVerxioTerminalOutput('Hermes Agent Status')).toBe('Verxio Agent Status')
  })
})

describe('buildToolView terminal title', () => {
  it('labels a finished Hermes command as Verxio', () => {
    const view = buildToolView(
      {
        args: { command: 'hermes tools list' },
        result: { stdout: 'Hermes Agent Status' },
        toolName: 'terminal',
        type: 'tool-call'
      },
      ''
    )

    expect(view.title).toBe('Ran · verxio tools list')
    expect(view.stdout).toBe('Verxio Agent Status')
  })
})
