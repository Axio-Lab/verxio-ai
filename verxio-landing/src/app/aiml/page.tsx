import type { Metadata } from 'next'
import { CheckCircle2 } from 'lucide-react'

import { AimlFooter } from './_components/aiml-footer'
import { AimlHeader } from './_components/aiml-header'
import { CheckoutButton } from './_components/checkout-button'
import { StickyCheckoutBar } from './_components/sticky-checkout-bar'
import {
  AIML_AUDIENCE,
  AIML_FAQ,
  AIML_INCLUDES,
  AIML_MODULES,
  AIML_PAINS,
  AIML_PRODUCT,
  AIML_STACK_TOTAL,
  AIML_STEPS,
  formatNgn,
} from '@/lib/aiml'
import { SITE_URL } from '@/lib/site'

const pageUrl = `${SITE_URL}/aiml`

export const metadata: Metadata = {
  title: `${AIML_PRODUCT.name} — ${AIML_PRODUCT.headline}`,
  description: AIML_PRODUCT.description,
  alternates: { canonical: pageUrl },
  openGraph: {
    title: AIML_PRODUCT.name,
    description: AIML_PRODUCT.headline,
    url: pageUrl,
    siteName: 'Verxio',
    type: 'website',
  },
}

export default function AimlSalesPage() {
  return (
    <div className="min-h-screen bg-white pb-28">
      <AimlHeader />

      <section className="px-6 pb-16 pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Digital product · Funnel offer
          </p>
          <h1 className="mt-5 text-4xl font-bold leading-[1.12] tracking-tight text-gray-900 sm:text-5xl">
            {AIML_PRODUCT.headline}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-gray-600">
            {AIML_PRODUCT.tagline}
          </p>
          <div className="mt-8 flex justify-center">
            <CheckoutButton />
          </div>
          <p className="mt-4 text-sm text-gray-500">
            {AIML_PRODUCT.billing} · {AIML_PRODUCT.format} · Keep this edition
          </p>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            If this is your week, this library is for you
          </h2>
          <ul className="mt-8 space-y-4">
            {AIML_PAINS.map((pain) => (
              <li key={pain} className="flex gap-3 text-base leading-relaxed text-gray-700">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {pain}
              </li>
            ))}
          </ul>
          <p className="mt-8 text-base leading-relaxed text-gray-600">
            AI is not the bottleneck. The missing piece is a revenue system — offer, content, outreach, delivery —
            you can run without inventing it from a blank chat.
          </p>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Everything in the {AIML_PRODUCT.name}
          </h2>
          <p className="mt-3 text-base text-gray-600">
            Six systems. One checkout. Built to be used, not collected.
          </p>
          <ol className="mt-10 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200">
            {AIML_MODULES.map((module, index) => (
              <li key={module.title} className="flex items-start justify-between gap-4 bg-white px-5 py-5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                    System {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-gray-900">{module.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{module.body}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-gray-900">{formatNgn(module.valueNgn)}</p>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-4 bg-gray-50 px-5 py-4">
              <span className="text-sm font-medium text-gray-700">Stacked value</span>
              <span className="text-lg font-bold text-gray-900">{formatNgn(AIML_STACK_TOTAL)}</span>
            </li>
          </ol>
          <div className="mt-8 flex justify-center">
            <CheckoutButton />
          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">How the funnel works</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-3">
            {AIML_STEPS.map((item) => (
              <li key={item.step}>
                <p className="text-xs font-bold tracking-widest text-primary">{item.step}</p>
                <h3 className="mt-2 text-base font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-3xl gap-10 sm:grid-cols-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">This is for you if</h2>
            <ul className="mt-5 space-y-3">
              {AIML_AUDIENCE.for.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-gray-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">This is not for you if</h2>
            <ul className="mt-5 space-y-3">
              {AIML_AUDIENCE.notFor.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-gray-600">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Today&apos;s offer</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Get the full library for {AIML_PRODUCT.priceLabel}
          </h2>
          <p className="mt-3 text-sm text-gray-500">
            <span className="mr-2 line-through">{formatNgn(AIML_STACK_TOTAL)}</span>
            stacked value · you pay {AIML_PRODUCT.priceLabel} once
          </p>
          <ul className="mx-auto mt-8 max-w-sm space-y-3 text-left">
            {AIML_INCLUDES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex justify-center">
            <CheckoutButton />
          </div>
          <p className="mt-4 text-xs text-gray-500">Instant access after checkout. No subscription.</p>
        </div>
      </section>

      <section className="border-t border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Questions</h2>
          <dl className="mt-10 space-y-8">
            {AIML_FAQ.map((item) => (
              <div key={item.q}>
                <dt className="text-base font-semibold text-gray-900">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-gray-600">{item.a}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-12 text-center">
            <CheckoutButton />
          </div>
        </div>
      </section>

      <AimlFooter />
      <StickyCheckoutBar />
    </div>
  )
}
