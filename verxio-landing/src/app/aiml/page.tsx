import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BookOpen, CheckCircle2, Sparkles } from 'lucide-react'

import { AimlFooter } from './_components/aiml-footer'
import { AimlHeader } from './_components/aiml-header'
import {
  AIML_CHECKOUT_PATH,
  AIML_FAQ,
  AIML_INCLUDES,
  AIML_MODULES,
  AIML_PRODUCT,
} from '@/lib/aiml'
import { SITE_URL } from '@/lib/site'

const pageUrl = `${SITE_URL}/aiml`

export const metadata: Metadata = {
  title: `${AIML_PRODUCT.name} — Digital library`,
  description: AIML_PRODUCT.description,
  alternates: { canonical: pageUrl },
  openGraph: {
    title: AIML_PRODUCT.name,
    description: AIML_PRODUCT.tagline,
    url: pageUrl,
    siteName: 'Verxio',
    type: 'website',
  },
}

function CheckoutButton({ className = '' }: { className?: string }) {
  return (
    <Link
      href={AIML_CHECKOUT_PATH}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-7 py-3.5 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${className}`}
    >
      Get the library — {AIML_PRODUCT.priceLabel}
      <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
    </Link>
  )
}

export default function AimlSalesPage() {
  return (
    <div className="min-h-screen bg-white">
      <AimlHeader />

      <section className="relative overflow-hidden pb-20 pt-16">
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/4 top-0 h-[480px] w-[480px] rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full bg-secondary/5 blur-3xl" />
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-16 px-6 lg:grid-cols-2">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-primary">
              Digital product
            </div>
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              {AIML_PRODUCT.name}
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-gray-600">{AIML_PRODUCT.tagline}</p>
            <div className="flex flex-wrap gap-4">
              <CheckoutButton />
            </div>
            <p className="text-sm text-gray-500">
              {AIML_PRODUCT.billing} · {AIML_PRODUCT.format}
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-2 border-b border-gray-100 pb-4">
              <BookOpen className="h-4 w-4 text-primary" aria-hidden />
              <span className="text-sm font-semibold text-gray-900">What you get</span>
            </div>
            <ul className="space-y-3">
              {AIML_INCLUDES.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-baseline gap-2 border-t border-gray-100 pt-4">
              <span className="text-4xl font-bold tracking-tight text-gray-900">
                {AIML_PRODUCT.priceLabel}
              </span>
              <span className="text-sm text-gray-500">one-time</span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gray-50/80 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary">
              Inside the library
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Six systems, one library
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Structure first. Copy, offers, and recipes you can run — then refine.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {AIML_MODULES.map((module) => (
              <div
                key={module.title}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{module.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{module.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            FAQ
          </h2>
          <dl className="mt-12 space-y-8">
            {AIML_FAQ.map((item) => (
              <div key={item.q}>
                <dt className="text-base font-semibold text-gray-900">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-gray-600">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Get the {AIML_PRODUCT.name}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600">{AIML_PRODUCT.description}</p>
          <div className="mt-10 flex justify-center">
            <CheckoutButton />
          </div>
        </div>
      </section>

      <AimlFooter />
    </div>
  )
}
