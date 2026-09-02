'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function msUntilEndOfDay(): number {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return Math.max(0, end.getTime() - Date.now())
}

function formatRemaining(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1_000)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function useEndOfDayCountdown(): string | null {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    function tick() {
      setRemaining(msUntilEndOfDay())
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  return remaining === null ? null : formatRemaining(remaining)
}

export function UrgencyCountdown({ variant }: { variant: 'banner' | 'inline' }) {
  const time = useEndOfDayCountdown()
  const display = time ?? '--:--:--'

  if (variant === 'banner') {
    return (
      <div className="bg-red-600 px-4 py-2 text-center shadow-[0_0_28px_rgba(220,38,38,0.7)]">
        <p className="text-base font-bold uppercase tracking-wide text-white">
          Free bonuses end in{' '}
          <span className="inline-block tabular-nums tracking-widest motion-safe:animate-pulse" aria-live="polite">
            {display}
          </span>
        </p>
      </div>
    )
  }

  return (
    <p className="flex items-center justify-center gap-2 text-lg font-bold text-red-600">
      <Clock className="h-5 w-5 shrink-0 motion-safe:animate-pulse" aria-hidden />
      <span>
        Bonus offer ends in <span className="tabular-nums tracking-widest">{display}</span>
      </span>
    </p>
  )
}
