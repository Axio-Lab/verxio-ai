import type { MessagingEnvVarInfo } from '@/hermes'
import { useI18n } from '@/i18n'

import { MessagingEnvSettingsPanel } from './messaging-env-settings-panel'

const WHATSAPP_CLOUD_SELECT_OPTIONS: Record<string, Array<{ label: string; value: string }>> = {
  WHATSAPP_CLOUD_DM_POLICY: [
    { value: 'open', label: 'open' },
    { value: 'allowlist', label: 'allowlist' },
    { value: 'disabled', label: 'disabled' }
  ],
  WHATSAPP_CLOUD_GROUP_POLICY: [
    { value: 'open', label: 'open' },
    { value: 'allowlist', label: 'allowlist' },
    { value: 'disabled', label: 'disabled' }
  ]
}

interface WhatsAppCloudSettingsPanelProps {
  edits: Record<string, string>
  envVars: MessagingEnvVarInfo[]
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  saving: string | null
}

export function WhatsAppCloudSettingsPanel({
  edits,
  envVars,
  onClear,
  onEdit,
  saving
}: WhatsAppCloudSettingsPanelProps) {
  const { t } = useI18n()
  const ws = t.messaging.whatsappCloudSettings

  return (
    <MessagingEnvSettingsPanel
      booleanKeys={['WHATSAPP_CLOUD_ALLOW_ALL_USERS']}
      description={ws.description}
      edits={edits}
      envVars={envVars}
      onClear={onClear}
      onEdit={onEdit}
      saving={saving}
      sections={[
        {
          title: ws.sections.credentials,
          keys: [
            'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
            'WHATSAPP_CLOUD_ACCESS_TOKEN',
            'WHATSAPP_CLOUD_APP_SECRET',
            'WHATSAPP_CLOUD_VERIFY_TOKEN',
            'WHATSAPP_CLOUD_APP_ID',
            'WHATSAPP_CLOUD_WABA_ID'
          ]
        },
        {
          title: ws.sections.webhook,
          hint: ws.webhookHint,
          keys: [
            'WHATSAPP_CLOUD_WEBHOOK_HOST',
            'WHATSAPP_CLOUD_WEBHOOK_PORT',
            'WHATSAPP_CLOUD_WEBHOOK_PATH',
            'WHATSAPP_CLOUD_API_VERSION'
          ]
        },
        {
          title: ws.sections.access,
          keys: [
            'WHATSAPP_CLOUD_ALLOWED_USERS',
            'WHATSAPP_CLOUD_ALLOW_ALL_USERS',
            'WHATSAPP_CLOUD_DM_POLICY',
            'WHATSAPP_CLOUD_ALLOW_FROM'
          ]
        },
        {
          title: ws.sections.delivery,
          hint: ws.homeChannelHint,
          keys: ['WHATSAPP_CLOUD_HOME_CHANNEL', 'WHATSAPP_CLOUD_HOME_CHANNEL_NAME']
        },
        {
          title: ws.sections.groups,
          hint: ws.groupsHint,
          keys: ['WHATSAPP_CLOUD_GROUP_POLICY', 'WHATSAPP_CLOUD_GROUP_ALLOW_FROM']
        }
      ]}
      selectOptions={WHATSAPP_CLOUD_SELECT_OPTIONS}
      title={ws.title}
    />
  )
}
