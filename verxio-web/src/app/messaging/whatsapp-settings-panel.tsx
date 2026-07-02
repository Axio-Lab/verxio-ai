import type { MessagingEnvVarInfo } from '@/hermes'
import { useI18n } from '@/i18n'

import { MessagingEnvSettingsPanel } from './messaging-env-settings-panel'

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

interface WhatsAppSettingsPanelProps {
  edits: Record<string, string>
  envVars: MessagingEnvVarInfo[]
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  saving: string | null
}

export function WhatsAppSettingsPanel({ edits, envVars, onClear, onEdit, saving }: WhatsAppSettingsPanelProps) {
  const { t } = useI18n()
  const ws = t.messaging.whatsappSettings

  return (
    <MessagingEnvSettingsPanel
      booleanKeys={['WHATSAPP_ALLOW_ALL_USERS', 'WHATSAPP_REQUIRE_MENTION', 'WHATSAPP_DEBUG']}
      description={ws.description}
      edits={edits}
      envVars={envVars}
      hiddenKeys={['WHATSAPP_ENABLED']}
      onClear={onClear}
      onEdit={onEdit}
      saving={saving}
      sections={[
        { title: ws.sections.bridge, keys: ['WHATSAPP_MODE'] },
        {
          title: ws.sections.access,
          keys: ['WHATSAPP_ALLOWED_USERS', 'WHATSAPP_ALLOW_ALL_USERS', 'WHATSAPP_DM_POLICY']
        },
        {
          title: ws.sections.delivery,
          hint: ws.homeChannelHint,
          keys: ['WHATSAPP_HOME_CHANNEL', 'WHATSAPP_HOME_CHANNEL_NAME']
        },
        {
          title: ws.sections.groups,
          hint: ws.groupsHint,
          keys: [
            'WHATSAPP_GROUP_POLICY',
            'WHATSAPP_GROUP_ALLOWED_USERS',
            'WHATSAPP_REQUIRE_MENTION',
            'WHATSAPP_MENTION_PATTERNS',
            'WHATSAPP_FREE_RESPONSE_CHATS'
          ]
        },
        { title: ws.sections.advanced, advanced: true, keys: ['WHATSAPP_DEBUG'] }
      ]}
      selectOptions={WHATSAPP_SELECT_OPTIONS}
      title={ws.title}
    />
  )
}
