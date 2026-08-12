import type { ComponentProps, CSSProperties } from 'react'

import { cn } from '@/lib/utils'

export const VERXIO_WORDMARK = 'VERXIO'

type VerxioWordmarkProps = ComponentProps<'span'> & {
  textClassName?: string
  /**
   * animated — session intro (plus-lighter blend on tinted canvas).
   * brand — same type/sheen/glow as animated, but mix-blend normal so it stays
   *         visible on white share/agent footers.
   * solid — flat fill, no sheen.
   */
  variant?: 'animated' | 'brand' | 'solid'
}

export function VerxioWordmark({
  className,
  style,
  textClassName,
  variant = 'animated',
  ...props
}: VerxioWordmarkProps) {
  return (
    <span
      aria-label={VERXIO_WORDMARK}
      className={cn(
        'fit-text verxio-wordmark font-bold uppercase leading-[0.9] tracking-[0.08em] text-midground',
        variant === 'animated' && 'mix-blend-plus-lighter dark:text-foreground/90',
        variant === 'brand' && 'verxio-wordmark--brand',
        variant === 'solid' && 'verxio-wordmark--solid',
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
