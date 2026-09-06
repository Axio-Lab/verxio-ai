import Link from 'next/link'

import { AIML_CHECKOUT_PATH, AIML_OFFER, AIML_PRODUCT } from '@/lib/aiml'

export function StickyCheckoutBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(17,24,39,0.06)] backdrop-blur-lg">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-gray-900">{AIML_PRODUCT.name}</p>
          <p className="text-sm text-gray-500">
            <span className="text-red-600 line-through">{AIML_OFFER.bonusesTotal}</span>{' '}
            <span className="font-semibold text-green-700">{AIML_PRODUCT.priceLabel}</span>
          </p>
        </div>
        <Link
          href={AIML_CHECKOUT_PATH}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-base font-semibold text-white shadow-sm transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {AIML_PRODUCT.ctaLabel}
        </Link>
      </div>
    </div>
  )
}
