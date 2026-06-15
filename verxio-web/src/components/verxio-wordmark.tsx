import type { ComponentProps, CSSProperties } from 'react'

import { cn } from '@/lib/utils'

export const VERXIO_WORDMARK = 'VERXIO'

type VerxioWordmarkProps = ComponentProps<'span'> & {
  textClassName?: string
}

export function VerxioWordmark({ className, style, textClassName, ...props }: VerxioWordmarkProps) {
  return (
    <span
      aria-label={VERXIO_WORDMARK}
      className={cn(
        "fit-text verxio-wordmark font-['Collapse'] font-bold uppercase leading-[0.9] tracking-[0.08em] text-midground mix-blend-plus-lighter dark:text-foreground/90",
        className
      )}
      style={
        {
          '--fit-text-line-height': '0.9',
          '--fit-text-min': '2.75rem',
          ...style
        } as CSSProperties
      }
      {...props}
    >
      <span>
        <span className={cn('verxio-wordmark__text', textClassName)}>{VERXIO_WORDMARK}</span>
      </span>
      <span aria-hidden="true">{VERXIO_WORDMARK}</span>
    </span>
  )
}
