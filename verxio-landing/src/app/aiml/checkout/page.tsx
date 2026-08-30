import type { Metadata } from 'next'

import { CheckoutOrder } from '../_components/checkout-order'
import { ImagePlaceholder } from '../_components/image-placeholder'
import { AIML_ORDER_BUMP, AIML_PLACEHOLDERS, AIML_PRODUCT } from '@/lib/aiml'
import { SITE_URL } from '@/lib/site'

const pageUrl = `${SITE_URL}/aiml/checkout`

export const metadata: Metadata = {
  title: `Checkout — ${AIML_PRODUCT.name}`,
  description: AIML_PRODUCT.description,
  alternates: { canonical: pageUrl },
  robots: { index: false, follow: true },
}

export default function AimlCheckoutPage() {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          Get the {AIML_PRODUCT.name}
        </h1>
        <p className="mt-3 text-gray-600">
          {AIML_PRODUCT.skillCount} expert AI skills for {AIML_PRODUCT.priceLabel}. One payment. No subscriptions.
        </p>
        <p className="mt-3 text-sm text-gray-500">
          Unlock the full {AIML_PRODUCT.fullSkillCount}-skill library for just {AIML_ORDER_BUMP.priceLabel} more.
        </p>

        <div className="mt-8">
          <ImagePlaceholder
            label={AIML_PLACEHOLDERS.orderBump.label}
            idea={AIML_PLACEHOLDERS.orderBump.idea}
          />
        </div>

        <div className="mt-10">
          <CheckoutOrder />
        </div>
      </main>
    </div>
  )
}
