import { Button } from '@/components/ui/button'
import { KeyRound } from '@/lib/icons'
import { verxioApiEnabled } from '@/lib/verxio-api'

import { SectionHeading } from './primitives'

interface InferenceProviderSettingsProps {
  onOpenProviderKeys: () => void
}

export function InferenceProviderSettings({ onOpenProviderKeys }: InferenceProviderSettingsProps) {
  if (!verxioApiEnabled()) {
    return null
  }

  return (
    <section className="mb-5 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <SectionHeading icon={KeyRound} meta="Your keys" title="Models" />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Connect your own provider account or API key. The model selector uses that connection.
      </p>
      <Button onClick={onOpenProviderKeys} size="sm" type="button" variant="textStrong">
        Open provider keys
      </Button>
    </section>
  )
}
