import { describe, expect, it } from 'vitest'

import { buildToolView, displayVerxioCommand, displayVerxioTerminalOutput } from './tool-fallback-model'

describe('displayVerxioCommand', () => {
  it('shows the desktop CLI as Verxio', () => {
    expect(displayVerxioCommand('from hermes_tools import terminal')).toBe('from verxio_tools import terminal')
    expect(displayVerxioCommand('/var/folders/T/hermes_sandbox_iqp78t4h/script.py')).toBe(
      '/var/folders/T/verxio_sandbox_iqp78t4h/script.py'
    )
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
  it('renames the status banner and the echoed command', () => {
    expect(displayVerxioTerminalOutput('Hermes Agent Status')).toBe('Verxio Agent Status')
    expect(displayVerxioTerminalOutput("hermes chat -q 'health check'")).toBe("verxio chat -q 'health check'")
    expect(displayVerxioTerminalOutput('File "/tmp/hermes_sandbox_iqp78t4h/script.py"')).toBe(
      'File "/tmp/verxio_sandbox_iqp78t4h/script.py"'
    )
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

  it('rewrites the command echoed in the output panel', () => {
    const view = buildToolView(
      {
        args: { command: "hermes chat -q 'health check'" },
        result: { output: "hermes chat -q 'health check'" },
        toolName: 'terminal',
        type: 'tool-call'
      },
      ''
    )

    expect(view.title).toBe("Ran · verxio chat -q 'health check'")
    expect(view.detail).toBe("verxio chat -q 'health check'")
    expect(view.detail).not.toContain('hermes')
  })

  it('rewrites the command shown while the tool is still running', () => {
    const view = buildToolView(
      {
        args: {
          command: "hermes chat -q 'health check'",
          preview: "hermes chat -q 'health check'"
        },
        toolName: 'terminal',
        type: 'tool-call'
      },
      ''
    )

    expect(view.title).toBe("Running · verxio chat -q 'health check'")
    expect(view.detail).not.toContain('hermes')
    expect(view.detail).toContain('verxio chat')
  })
})
