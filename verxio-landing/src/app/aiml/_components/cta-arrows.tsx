import { ArrowDown } from 'lucide-react'

export function CtaArrows() {
  return (
    <div className="flex justify-center gap-4" aria-hidden>
      <ArrowDown className="h-8 w-8 stroke-[2.5] text-red-600 motion-safe:animate-bounce" />
      <ArrowDown className="h-8 w-8 stroke-[2.5] text-red-600 motion-safe:animate-bounce [animation-delay:150ms]" />
      <ArrowDown className="h-8 w-8 stroke-[2.5] text-red-600 motion-safe:animate-bounce [animation-delay:300ms]" />
    </div>
  )
}
