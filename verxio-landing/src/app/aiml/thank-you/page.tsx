import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import {
  AIML_PRODUCT,
  AIML_SUPPORT_EMAIL,
  AIML_THANK_YOU,
  AIML_THANK_YOU_PATH,
} from '@/lib/aiml'
import { SITE_URL, appPath } from '@/lib/site'

const pageUrl = `${SITE_URL}${AIML_THANK_YOU_PATH}`

export const metadata: Metadata = {
  title: `Thank you for your purchase | ${AIML_PRODUCT.name}`,
  description: AIML_THANK_YOU.lead,
  alternates: { canonical: pageUrl },
  robots: { index: false, follow: false },
  openGraph: {
    title: `Thank you for your purchase | ${AIML_PRODUCT.name}`,
    description: AIML_THANK_YOU.lead,
    url: pageUrl,
    siteName: 'Verxio',
    type: 'website',
  },
}

const ctaClassName =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-8 py-5 text-center text-xl font-black uppercase tracking-wide text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:min-h-16 sm:text-2xl'

function stepHref(step: (typeof AIML_THANK_YOU.steps)[number]): string | null {
  if (!('href' in step) || !step.href) {
    return null
  }

  if ('app' in step && step.app) {
    return appPath(step.href)
  }

  return step.href
}

export default function AimlThankYouPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <main className="px-6 pb-20 pt-14 sm:pt-20">
        <header className="mx-auto max-w-4xl text-center">
          <p className="text-lg font-black uppercase tracking-[0.2em] text-primary sm:text-xl">
            {AIML_PRODUCT.name}
          </p>
          <h1 className="mt-5 text-[2.75rem] font-black leading-[0.95] tracking-tight text-gray-900 sm:text-7xl lg:text-8xl">
            {AIML_THANK_YOU.title}
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-2xl font-bold leading-snug text-gray-900 sm:text-4xl">
            {AIML_THANK_YOU.lead}
          </p>
        </header>

        <ol className="mx-auto mt-14 max-w-3xl space-y-6">
          {AIML_THANK_YOU.steps.map((step, index) => {
            const href = stepHref(step)
            const cta = 'cta' in step ? step.cta : null
            const featured = index === 0

            return (
              <li key={step.number}>
                <article
                  className={
                    featured
                      ? 'rounded-3xl bg-gray-950 px-6 py-8 text-white sm:px-10 sm:py-10'
                      : 'rounded-3xl border-2 border-gray-900 bg-white px-6 py-8 sm:px-10 sm:py-10'
                  }
                >
                  <p
                    className={
                      featured
                        ? 'text-2xl font-black tracking-tight text-primary sm:text-3xl'
                        : 'text-2xl font-black tracking-tight text-primary sm:text-3xl'
                    }
                  >
                    STEP {step.number}
                  </p>
                  <h2
                    className={
                      featured
                        ? 'mt-3 text-4xl font-black leading-none tracking-tight sm:text-6xl'
                        : 'mt-3 text-3xl font-black leading-none tracking-tight text-gray-900 sm:text-5xl'
                    }
                  >
                    {step.title}
                  </h2>
                  <p
                    className={
                      featured
                        ? 'mt-5 text-xl font-bold leading-snug text-white sm:text-2xl'
                        : 'mt-5 text-xl font-bold leading-snug text-gray-900 sm:text-2xl'
                    }
                  >
                    {step.body}
                  </p>
                  {href && cta ? (
                    <a
                      href={href}
                      className={
                        featured
                          ? `${ctaClassName} mt-8 bg-primary hover:brightness-110 focus-visible:ring-primary`
                          : `${ctaClassName} mt-8 bg-gray-950 hover:bg-gray-800 focus-visible:ring-gray-950`
                      }
                      {...('external' in step && step.external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {cta}
                      <ArrowUpRight className="h-6 w-6 shrink-0" aria-hidden />
                    </a>
                  ) : null}
                </article>
              </li>
            )
          })}
        </ol>

        <p className="mx-auto mt-12 max-w-3xl text-center text-lg font-bold text-gray-900 sm:text-xl">
          Questions?{' '}
          <a
            href={`mailto:${AIML_SUPPORT_EMAIL}`}
            className="rounded text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {AIML_SUPPORT_EMAIL}
          </a>
        </p>
      </main>

      <footer className="border-t-2 border-gray-900 px-6 py-8">
        <p className="text-center text-base font-bold text-gray-900">
          <Link
            href="/"
            className="rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Verxio.xyz
          </Link>
        </p>
      </footer>
    </div>
  )
}
