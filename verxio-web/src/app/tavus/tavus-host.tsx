import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import { TavusCallPanel } from '@/app/tavus/call-panel'
import { Sparkles } from '@/lib/icons'
import { $tavusCallOpen, openTavusCall } from '@/store/tavus-call'

export function TavusHost({ setTitlebarToolGroup }: { setTitlebarToolGroup?: SetTitlebarToolGroup }) {
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

  if (!open) {
    return null
  }

  return <TavusCallPanel />
}
