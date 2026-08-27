import type { Metadata } from 'next'

import { CheckoutOrder } from '../_components/checkout-order'
import { AIML_PRODUCT } from '@/lib/aiml'
import { SITE_URL } from '@/lib/site'

const pageUrl = `${SITE_URL}/aiml/checkout`

export const metadata: Metadata = {
  title: `Checkout — ${AIML_PRODUCT.name}`,
  description: `Buy ${AIML_PRODUCT.name}. ${AIML_PRODUCT.billing}.`,
  alternates: { canonical: pageUrl },
  robots: { index: false, follow: true },
}

export default function AimlCheckoutPage() {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          {AIML_PRODUCT.name}
        </h1>
        <p className="mt-3 text-gray-600">{AIML_PRODUCT.tagline}</p>

        <div className="mt-10">
          <CheckoutOrder />
        </div>
      </main>
    </div>
  )
}
