import { AIML_CHECKOUT_PATH, AIML_PRODUCT, AIML_STACK_TOTAL, formatNgn } from '@/lib/aiml'
import Link from 'next/link'

export function StickyCheckoutBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(17,24,39,0.06)] backdrop-blur-lg">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{AIML_PRODUCT.name}</p>
          <p className="text-xs text-gray-500">
            <span className="mr-1.5 text-gray-400 line-through">{formatNgn(AIML_STACK_TOTAL)}</span>
            {AIML_PRODUCT.priceLabel} one-time
          </p>
        </div>
        <Link
          href={AIML_CHECKOUT_PATH}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Continue to checkout
        </Link>
      </div>
    </div>
  )
}
