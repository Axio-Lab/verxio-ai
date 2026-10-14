import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import { speakOnTavusCall, tavusCallIsLive, TavusCallPanel } from '@/app/tavus/call-panel'
import { getSessionMessages } from '@/hermes'
import { Sparkles } from '@/lib/icons'
import { runNextTavusTask } from '@/lib/tavus-task-runner'
import { nextTavusTask, updateTavusTask } from '@/lib/verxio-api'
import { $gateway } from '@/store/gateway'
import { $sidebarProjects, addSessionToSidebarProject, createSidebarProject } from '@/store/layout'
import { notify } from '@/store/notifications'
import { $tavusCallOpen, openTavusCall } from '@/store/tavus-call'

function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(part => {
      if (typeof part === 'string') {
        return part
      }

      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text || '')
      }

      return ''
    })
    .join('')
    .trim()
}

async function waitForAssistantReply(sessionId: string): Promise<string> {
  const deadline = Date.now() + 90_000

  while (Date.now() < deadline) {
    try {
      const payload = await getSessionMessages(sessionId)

      const text = payload.messages
        .filter(message => message.role === 'assistant')
        .map(message => messageText(message.text ?? message.content))
        .filter(Boolean)
        .at(-1)

      if (text) {
        return text.slice(0, 700)
      }
    } catch {
      // Hermes writes the stored session id after the first turn lands.
    }

    await new Promise(resolve => window.setTimeout(resolve, 2000))
  }

  return 'I started that in Verxio. The full result is in your Calls chat.'
}

function callsProjectId(): string {
  const existing = $sidebarProjects.get().projects.find(project => project.name === 'Calls')

  if (existing) {
    return existing.id
  }

  return createSidebarProject('Calls') || ''
}

export function TavusHost({ setTitlebarToolGroup }: { setTitlebarToolGroup?: SetTitlebarToolGroup }) {
  const gateway = useStore($gateway)
  const open = useStore($tavusCallOpen)

  useEffect(() => {
    if (!setTitlebarToolGroup) {
      return
    }

    setTitlebarToolGroup('tavus-call', [
      {
        icon: <Sparkles className="size-3.5" />,
        id: 'tavus-call',
        label: 'Call',
        onSelect: () => openTavusCall()
      }
    ])

    return () => setTitlebarToolGroup('tavus-call', [])
  }, [setTitlebarToolGroup])

  useEffect(() => {
    if (!gateway) {
      return
    }

    let stopped = false

    const loop = async () => {
      while (!stopped) {
        try {
          await runNextTavusTask(
            {
              claim: async () => (await nextTavusTask(20)).task,
              fileInCalls: sessionId => {
                const projectId = callsProjectId()

                if (projectId && sessionId) {
                  addSessionToSidebarProject(projectId, sessionId)
                }
              },
              finish: async (taskId, status, resultText, hermesSessionId) => {
                await updateTavusTask(taskId, { hermesSessionId, resultText, status })
              },
              notify: message => notify({ kind: 'info', message }),
              speak: speakOnTavusCall,
              submit: async instruction => {
                const created = await gateway.request<{ session_id?: string; stored_session_id?: string }>(
                  'session.create',
                  {}
                )

                const sessionId = created.session_id || created.stored_session_id || ''
                const title = instruction.slice(0, 72)

                if (sessionId) {
                  await gateway.request('session.title', { session_id: sessionId, title })
                  await gateway.request('prompt.submit', { session_id: sessionId, text: instruction })
                }

                const resultText = sessionId
                  ? await waitForAssistantReply(sessionId)
                  : 'I could not start that in Verxio.'

                return {
                  resultText,
                  sessionId
                }
              }
            },
            tavusCallIsLive
          )
        } catch {
          await new Promise(resolve => window.setTimeout(resolve, 3000))
        }
      }
    }

    void loop()

    return () => {
      stopped = true
    }
  }, [gateway])

  if (!open) {
    return null
  }

  return <TavusCallPanel />
}
