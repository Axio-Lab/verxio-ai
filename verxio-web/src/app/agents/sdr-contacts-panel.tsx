import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Download } from '@/lib/icons'
import { exportSdrContacts, listSdrContacts, type SdrContact } from '@/lib/verxio-api'

function triggerDownload(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/vcard' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function SdrContactsPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [contacts, setContacts] = useState<SdrContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await listSdrContacts(agentId)
      setContacts(result.contacts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load contacts.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onExport = async () => {
    setExporting(true)
    setError(null)

    try {
      const result = await exportSdrContacts(agentId)
      triggerDownload(result.filename || `sdr-contacts-${agentName}.vcf`, result.vcf)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export contacts.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Contacts</h3>
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            People who messaged this SDR agent on WhatsApp, Telegram, Slack, or Discord.
          </p>
        </div>
        <Button
          disabled={exporting || contacts.length === 0}
          onClick={() => void onExport()}
          size="sm"
          type="button"
          variant="outline"
        >
          <Download className="size-4" />
          Export VCF
        </Button>
      </div>
      {error ? <p className="text-[0.7rem] text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-[0.7rem] text-muted-foreground">Loading contacts...</p>
      ) : contacts.length === 0 ? (
        <p className="rounded-md border border-dashed border-(--stroke-nous) px-3 py-6 text-center text-[0.7rem] text-muted-foreground">
          No contacts yet. Bind a messaging connection on the Triggers tab, then inbound chats will appear here.
        </p>
      ) : (
        <div className="grid gap-2">
          {contacts.map(contact => (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-(--stroke-nous) px-3 py-2"
              key={contact.id}
            >
              <div className="grid gap-0.5">
                <span className="text-xs font-medium">{contact.sender_name || contact.sender_id}</span>
                <span className="text-[0.65rem] text-muted-foreground">
                  {contact.channel} · {contact.sender_id}
                </span>
              </div>
              <span className="text-[0.65rem] text-muted-foreground">
                {new Date(contact.updated_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
