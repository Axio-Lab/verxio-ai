import type { ReactNode } from 'react'

import { useI18n } from '@/i18n'
import { formatCombo } from '@/lib/keybinds/combo'

import { COMPLETION_DRAWER_CLASS } from './completion-drawer'

const COMMON_COMMAND_KEYS = ['/help', '/clear', '/resume', '/details', '/copy', '/quit']

const HOTKEY_ROWS = [
  { key: '@', descKey: '@' },
  { key: '/', descKey: '/' },
  { key: '?', descKey: '?' },
  { key: formatCombo('enter'), descKey: 'enter' },
  { key: formatCombo('shift+enter'), descKey: 'shift+enter' },
  { key: formatCombo('mod+enter'), descKey: 'mod+enter' },
  { key: formatCombo('mod+shift+k'), descKey: 'mod+shift+k' },
  { key: formatCombo('mod+/'), descKey: 'mod+/' },
  { key: 'Esc', descKey: 'escape' },
  { key: '↑ / ↓', descKey: 'history' }
] as const

export function HelpHint() {
  const { t } = useI18n()
  const c = t.composer

  return (
    <div className={COMPLETION_DRAWER_CLASS} data-slot="composer-completion-drawer" data-state="open" role="dialog">
      <Section title={c.commonCommands}>
        {COMMON_COMMAND_KEYS.map(key => (
          <Row description={c.commandDescs[key] ?? ''} key={key} keyLabel={key} mono />
        ))}
      </Section>

      <Section title={c.hotkeys}>
        {HOTKEY_ROWS.map(row => (
          <Row description={c.hotkeyDescs[row.descKey] ?? ''} key={row.descKey} keyLabel={row.key} />
        ))}
      </Section>

      <p className="px-2.5 py-1 text-xs text-muted-foreground/80">
        <span className="font-mono text-foreground/80">/help</span> {c.helpFooter}
      </p>
    </div>
  )
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="grid gap-0.5 pt-0.5">
      <p className="px-2.5 pb-0.5 pt-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground/75">
        {title}
      </p>
      {children}
    </div>
  )
}

function Row({ description, keyLabel, mono = false }: { description: string; keyLabel: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 rounded-md px-2.5 py-1 text-xs">
      <span
        className={
          mono ? 'shrink-0 truncate font-mono font-medium text-foreground/85' : 'shrink-0 truncate text-foreground/85'
        }
      >
        {keyLabel}
      </span>
      <span className="min-w-0 truncate text-muted-foreground/80">{description}</span>
    </div>
  )
}
