import type { Metadata } from 'next'

import { AimlFooter } from '../_components/aiml-footer'
import { AimlHeader } from '../_components/aiml-header'
import { CheckoutForm } from '../_components/checkout-form'
import { AIML_INCLUDES, AIML_PRODUCT } from '@/lib/aiml'
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
      <AimlHeader checkout />

      <main className="mx-auto max-w-6xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Checkout</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          Get the {AIML_PRODUCT.name}
        </h1>
        <p className="mt-3 max-w-xl text-gray-600">{AIML_PRODUCT.tagline}</p>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <CheckoutForm />
          </div>

          <aside className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h2 className="text-sm font-semibold text-gray-900">Order summary</h2>
            <div className="mt-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-gray-900">{AIML_PRODUCT.name}</p>
                <p className="mt-1 text-sm text-gray-500">{AIML_PRODUCT.billing}</p>
              </div>
              <p className="text-lg font-bold text-gray-900">{AIML_PRODUCT.priceLabel}</p>
            </div>
            <ul className="mt-6 space-y-2 border-t border-gray-200 pt-4">
              {AIML_INCLUDES.map((item) => (
                <li key={item} className="text-sm text-gray-600">
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-baseline justify-between border-t border-gray-200 pt-4">
              <span className="text-sm font-medium text-gray-700">Total due today</span>
              <span className="text-2xl font-bold text-gray-900">{AIML_PRODUCT.priceLabel}</span>
            </div>
          </aside>
        </div>
      </main>

      <AimlFooter />
    </div>
  )
}
