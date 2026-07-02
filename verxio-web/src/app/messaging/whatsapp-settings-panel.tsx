import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { MessagingEnvVarInfo } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { ExternalLink, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { CREDENTIAL_CONTROL_CLASS } from '../settings/credential-key-ui'
import { ListRow } from '../settings/primitives'

const WHATSAPP_HIDDEN_KEYS = new Set(['WHATSAPP_ENABLED'])

const WHATSAPP_SECTIONS: Array<{
  id: keyof Translations['messaging']['whatsappSettings']['sections']
  keys: string[]
}> = [
  { id: 'bridge', keys: ['WHATSAPP_MODE'] },
  {
    id: 'access',
    keys: ['WHATSAPP_ALLOWED_USERS', 'WHATSAPP_ALLOW_ALL_USERS', 'WHATSAPP_DM_POLICY']
  },
  { id: 'delivery', keys: ['WHATSAPP_HOME_CHANNEL', 'WHATSAPP_HOME_CHANNEL_NAME'] },
  {
    id: 'groups',
    keys: [
      'WHATSAPP_GROUP_POLICY',
      'WHATSAPP_GROUP_ALLOWED_USERS',
      'WHATSAPP_REQUIRE_MENTION',
      'WHATSAPP_MENTION_PATTERNS',
      'WHATSAPP_FREE_RESPONSE_CHATS'
    ]
  },
  { id: 'advanced', keys: ['WHATSAPP_DEBUG'] }
]

const WHATSAPP_SELECT_OPTIONS: Record<string, Array<{ label: string; value: string }>> = {
  WHATSAPP_MODE: [
    { value: 'self-chat', label: 'self-chat' },
    { value: 'bot', label: 'bot' }
  ],
  WHATSAPP_DM_POLICY: [
    { value: 'open', label: 'open' },
    { value: 'allowlist', label: 'allowlist' },
    { value: 'disabled', label: 'disabled' }
  ],
  WHATSAPP_GROUP_POLICY: [
    { value: 'open', label: 'open' },
    { value: 'allowlist', label: 'allowlist' },
    { value: 'disabled', label: 'disabled' }
  ]
}

const WHATSAPP_BOOLEAN_KEYS = new Set(['WHATSAPP_ALLOW_ALL_USERS', 'WHATSAPP_REQUIRE_MENTION', 'WHATSAPP_DEBUG'])

function fieldCopy(field: MessagingEnvVarInfo, m: Translations['messaging']) {
  const localized = m.fieldCopy[field.key] || {}

  return {
    label: localized.label || field.prompt || field.key,
    help: localized.help || field.description,
    placeholder: localized.placeholder || field.prompt
  }
}

function resolveFieldValue(field: MessagingEnvVarInfo, edits: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(edits, field.key)) {
    return edits[field.key]
  }

  return field.current_value ?? ''
}

function isTruthyEnv(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

interface WhatsAppSettingsPanelProps {
  edits: Record<string, string>
  envVars: MessagingEnvVarInfo[]
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  saving: string | null
}

export function WhatsAppSettingsPanel({ edits, envVars, onClear, onEdit, saving }: WhatsAppSettingsPanelProps) {
  const { t } = useI18n()
  const m = t.messaging
  const ws = m.whatsappSettings
  const [showAdvanced, setShowAdvanced] = useState(false)
  const fieldsByKey = Object.fromEntries(envVars.map(field => [field.key, field]))

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>{ws.title}</SectionTitle>
        <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {ws.description}
        </p>
      </div>

      {WHATSAPP_SECTIONS.map(section => {
        const fields = section.keys
          .map(key => fieldsByKey[key])
          .filter((field): field is MessagingEnvVarInfo => Boolean(field) && !WHATSAPP_HIDDEN_KEYS.has(field.key))

        if (fields.length === 0) {
          return null
        }

        if (section.id === 'advanced') {
          return (
            <section key={section.id}>
              <button
                className="flex w-full items-center justify-between gap-2 py-0.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowAdvanced(value => !value)}
                type="button"
              >
                <span>{ws.sections.advanced}</span>
                <DisclosureCaret open={showAdvanced} size="0.875rem" />
              </button>
              {showAdvanced && (
                <div className="mt-3 grid gap-1">
                  {fields.map(field => (
                    <WhatsAppField
                      edits={edits}
                      field={field}
                      key={field.key}
                      onClear={onClear}
                      onEdit={onEdit}
                      saving={saving}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        }

        return (
          <section key={section.id}>
            <SectionTitle>{ws.sections[section.id]}</SectionTitle>
            {section.id === 'delivery' && (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{ws.homeChannelHint}</p>
            )}
            {section.id === 'groups' && <p className="mt-1 text-xs leading-5 text-muted-foreground">{ws.groupsHint}</p>}
            <div className="mt-3 grid gap-1">
              {fields.map(field => (
                <WhatsAppField
                  edits={edits}
                  field={field}
                  key={field.key}
                  onClear={onClear}
                  onEdit={onEdit}
                  saving={saving}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function WhatsAppField({
  edits,
  field,
  onClear,
  onEdit,
  saving
}: {
  edits: Record<string, string>
  field: MessagingEnvVarInfo
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  saving: string | null
}) {
  const { t } = useI18n()
  const m = t.messaging
  const copy = fieldCopy(field, m)
  const fieldId = `whatsapp-field-${field.key}`
  const value = resolveFieldValue(field, edits)
  const selectOptions = WHATSAPP_SELECT_OPTIONS[field.key]
  const isBoolean = WHATSAPP_BOOLEAN_KEYS.has(field.key)

  return (
    <ListRow
      action={
        <div className="flex items-center gap-2">
          {selectOptions ? (
            <Select onValueChange={next => onEdit(field.key, next)} value={value || undefined}>
              <SelectTrigger className={cn(CREDENTIAL_CONTROL_CLASS, 'min-w-[9rem]')} id={fieldId} size="sm">
                <SelectValue placeholder={field.is_set ? m.replaceValue : copy.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {selectOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : isBoolean ? (
            <Switch
              checked={isTruthyEnv(value)}
              id={fieldId}
              onCheckedChange={checked => onEdit(field.key, checked ? 'true' : 'false')}
              size="xs"
            />
          ) : (
            <Input
              className={CREDENTIAL_CONTROL_CLASS}
              id={fieldId}
              onChange={event => onEdit(field.key, event.target.value)}
              placeholder={field.is_set ? field.redacted_value || m.replaceValue : copy.placeholder}
              type="text"
              value={value}
            />
          )}
          {field.url && (
            <Button asChild className="size-8 shrink-0" title={m.openDocs} variant="ghost">
              <a href={field.url} rel="noreferrer" target="_blank">
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
          {field.is_set && (
            <Button
              className="size-8 shrink-0"
              disabled={saving === `clear:${field.key}`}
              onClick={() => onClear(field.key)}
              title={m.clearField(field.key)}
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      }
      description={copy.help}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <label htmlFor={fieldId}>{copy.label}</label>
          {field.is_set && <span className="text-[0.66rem] font-medium text-primary">{m.saved}</span>}
        </span>
      }
    />
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</h4>
}
