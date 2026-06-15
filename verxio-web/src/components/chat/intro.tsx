import { useEffect, useMemo, useState } from 'react'

import { VerxioWordmark } from '@/components/verxio-wordmark'

import introCopyJsonl from './intro-copy.jsonl?raw'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])
const INTRO_ROTATE_MS = 8_000

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What should Verxio operate today?',
    body: 'Ask me to turn business data into a CRM, dashboard, report, website, slide deck, or internal tool your team can use.'
  },
  {
    headline: 'Give Verxio a business outcome.',
    body: "Tell me the workflow, customer data, or bottleneck. I'll turn it into an executable system, not just advice."
  },
  {
    headline: 'What should your AI employee build?',
    body: 'I can draft reports, create HTML dashboards, build internal tools, organize leads, and package updates for your team.'
  },
  {
    headline: 'Where is the business losing time?',
    body: "Show me the repeated work. I'll map the workflow and create the file, tool, report, or site that removes it."
  },
  {
    headline: 'What should be automated first?',
    body: "Give me the task, spreadsheet, customer list, or process. I'll turn it into a working business action."
  }
]

function normalizeKey(value?: string): string {
  return (value || '').trim().toLowerCase()
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} Verxio need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} Verxio tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function copiesForPersonality(personality?: string): IntroCopy[] {
  const personalityKey = normalizeKey(personality)

  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
  }

  return INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)
}

function startIndex(copies: IntroCopy[], seed: number): number {
  if (!copies.length) {
    return 0
  }

  return Math.abs(seed) % copies.length
}

export function Intro({ personality, seed }: IntroProps) {
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const copies = useMemo(() => copiesForPersonality(personality), [personality])
  const combinedSeed = mountSeed + (seed ?? 0)
  const [index, setIndex] = useState(() => startIndex(copies, combinedSeed))

  useEffect(() => {
    setIndex(startIndex(copies, combinedSeed))
  }, [combinedSeed, copies])

  useEffect(() => {
    if (copies.length <= 1) {
      return
    }

    const id = window.setInterval(() => {
      setIndex(current => (current + 1) % copies.length)
    }, INTRO_ROTATE_MS)

    return () => window.clearInterval(id)
  }, [copies.length])

  const body = copies[index]?.body ?? FALLBACK_COPY[0].body

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-3 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <div className="w-full min-w-0">
        <VerxioWordmark className="mx-auto mb-3 w-[88%]" />

        <p aria-live="polite" className="m-0 text-center leading-normal tracking-tight">
          {body}
        </p>
      </div>
    </div>
  )
}
