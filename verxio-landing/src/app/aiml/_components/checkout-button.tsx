import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { AIML_CHECKOUT_PATH, AIML_PRODUCT } from '@/lib/aiml'

const ctaClassName =
  'inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-7 py-3.5 text-base font-semibold text-white shadow-md shadow-primary/20 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'

export function CheckoutButton({
  children,
  className = '',
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <Link href={AIML_CHECKOUT_PATH} className={`${ctaClassName} ${className}`}>
      {children ?? (
        <>
          {AIML_PRODUCT.ctaLabel} for {AIML_PRODUCT.priceLabel}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
        </>
      )}
    </Link>
  )
}
