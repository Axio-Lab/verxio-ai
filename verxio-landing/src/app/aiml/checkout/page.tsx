import type { Metadata } from 'next'

import { CheckoutOrder } from '../_components/checkout-order'
import { AIML_PRODUCT } from '@/lib/aiml'
import { SITE_URL } from '@/lib/site'

const pageUrl = `${SITE_URL}/aiml/checkout`

export const metadata: Metadata = {
  title: `Complete your order | ${AIML_PRODUCT.name}`,
  description: AIML_PRODUCT.description,
  alternates: { canonical: pageUrl },
  robots: { index: false, follow: true },
}

export default function AimlCheckoutPage() {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="sr-only">Complete your {AIML_PRODUCT.name} order</h1>
        <CheckoutOrder />
      </main>
    </div>
  )
}
