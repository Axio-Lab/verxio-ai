import type { Metadata } from 'next'
import Image from 'next/image'
import { CheckCircle2 } from 'lucide-react'

import { AimlFooter } from './_components/aiml-footer'
import { CheckoutButton } from './_components/checkout-button'
import { CtaArrows } from './_components/cta-arrows'
import { AimlFileVideo, AimlPlayerScript } from './_components/aiml-youtube-video'
import { MediaPlaceholder } from './_components/media-placeholder'
import { StickyCheckoutBar } from './_components/sticky-checkout-bar'
import {
  AIML_CLOSE,
  AIML_FROM_AI,
  AIML_GUARANTEE,
  AIML_INCLUDES_AFTER_VIDEO,
  AIML_INCLUDES_BEFORE_VIDEO,
  AIML_MEDIA_SLOTS,
  AIML_OPPORTUNITY,
  AIML_PRICE,
  AIML_PRODUCT,
  AIML_PROOF,
  AIML_REQUIREMENTS,
  AIML_STORY,
  AIML_WALKTHROUGH,
} from '@/lib/aiml'
import { SITE_URL } from '@/lib/site'

const pageUrl = `${SITE_URL}/aiml`

export const metadata: Metadata = {
  title: `${AIML_PRODUCT.name} | ${AIML_PRODUCT.headline}`,
  description: AIML_PRODUCT.tagline,
  alternates: { canonical: pageUrl },
  openGraph: {
    title: AIML_PRODUCT.name,
    description: AIML_PRODUCT.headline,
    url: pageUrl,
    siteName: 'Verxio',
    type: 'website',
  },
}

function SectionCta({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 space-y-4">
      <CtaArrows />
      <div className="flex justify-center">
        <CheckoutButton>{children}</CheckoutButton>
      </div>
    </div>
  )
}

function IncludeList({
  items,
}: {
  items: readonly { title: string; body: string }[]
}) {
  return (
    <ul className="space-y-5">
      {items.map((item) => (
        <li key={item.title} className="flex items-start gap-3 text-lg leading-relaxed text-gray-700">
          <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span>
            <span className="font-semibold text-gray-900">{item.title}.</span> {item.body}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function AimlSalesPage() {
  return (
    <div className="min-h-screen bg-white pb-28">
      <AimlPlayerScript />

      <section className="px-6 pb-16 pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-[2rem] font-bold leading-[1.18] tracking-tight text-gray-900 sm:text-[2.5rem] sm:leading-[1.12] lg:text-5xl">
            {AIML_PRODUCT.headline.split(AIML_PRODUCT.headlineAccent)[0]}
            <span className="text-primary">{AIML_PRODUCT.headlineAccent}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-xl leading-relaxed text-gray-600">{AIML_PRODUCT.tagline}</p>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_PROOF.title}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {AIML_PROOF.results.map((item) => (
              <article key={item.label} className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
                <p className="text-2xl font-bold tracking-tight text-gray-900">{item.amount}</p>
                <p className="mt-2 text-sm font-medium leading-relaxed text-gray-600">{item.label}</p>
              </article>
            ))}
          </div>
          <div className="mt-8">
            <MediaPlaceholder label={AIML_MEDIA_SLOTS.payment.label} hint={AIML_MEDIA_SLOTS.payment.hint} />
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl space-y-5">
          <p className="text-lg leading-relaxed text-gray-700">{AIML_STORY.ordinary}</p>
          <p className="text-lg font-semibold text-gray-900">{AIML_STORY.because}</p>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_STORY.needTitle}</h2>
          <p className="text-xl font-semibold text-gray-900">{AIML_STORY.needLead}</p>
          <p className="text-lg leading-relaxed text-gray-700">{AIML_STORY.needBody}</p>
          <p className="text-lg leading-relaxed text-gray-700">{AIML_STORY.possible}</p>
          <p className="text-lg font-semibold text-gray-900">{AIML_STORY.problemLead}</p>
          <p className="text-lg leading-relaxed text-gray-700">{AIML_STORY.problem}</p>
          <ul className="space-y-2 text-lg leading-relaxed text-gray-800">
            {AIML_STORY.needToKnow.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-xl font-semibold text-gray-900">{AIML_STORY.bridge}</p>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_FROM_AI.title}</h2>
          <div className="mt-6 space-y-4">
            {AIML_FROM_AI.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-lg leading-relaxed text-gray-700">
                {paragraph}
              </p>
            ))}
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {AIML_MEDIA_SLOTS.afterFromAi.map((slot, index) => (
              <MediaPlaceholder key={`${slot.label}-${index}`} label={slot.label} hint={slot.hint} />
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_REQUIREMENTS.title}</h2>
          <ul className="mt-6 space-y-2 text-lg leading-relaxed text-gray-800">
            {AIML_REQUIREMENTS.avoid.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-6 text-lg leading-relaxed text-gray-700">{AIML_REQUIREMENTS.need}</p>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Here&apos;s what you get inside:</h2>
          <div className="mt-8">
            <IncludeList items={AIML_INCLUDES_BEFORE_VIDEO} />
          </div>
          <div className="mt-10">
            <blockquote className="mb-6 text-center text-xl font-semibold italic leading-relaxed text-gray-900">
              “{AIML_WALKTHROUGH.quote}”
            </blockquote>
            <AimlFileVideo src={AIML_WALKTHROUGH.videoSrc} title={AIML_WALKTHROUGH.videoTitle} />
          </div>
          <div className="mt-10">
            <IncludeList items={AIML_INCLUDES_AFTER_VIDEO} />
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {AIML_MEDIA_SLOTS.afterIncludes.map((slot, index) => (
              <MediaPlaceholder key={`${slot.label}-${index}`} label={slot.label} hint={slot.hint} />
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-lg font-medium text-gray-800">{AIML_PRICE.lead}</p>
          <p className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            <span className="text-red-600 line-through">{AIML_PRODUCT.comparePriceLabel}</span>{' '}
            <span className="text-green-700">{AIML_PRODUCT.priceLabel}</span>
          </p>
          <p className="mt-4 text-xl font-semibold text-gray-900">{AIML_PRICE.billing}</p>
          <ul className="mt-6 space-y-2 text-lg leading-relaxed text-gray-700">
            {AIML_PRICE.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <SectionCta>
            {AIML_CLOSE.ctaHeading}
          </SectionCta>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_OPPORTUNITY.title}</h2>
          <div className="mt-6 space-y-4">
            {AIML_OPPORTUNITY.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-lg leading-relaxed text-gray-700">
                {paragraph}
              </p>
            ))}
          </div>
          <div className="mt-8">
            <MediaPlaceholder label={AIML_MEDIA_SLOTS.video.label} hint={AIML_MEDIA_SLOTS.video.hint} />
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_CLOSE.title}</h2>
          <ul className="mx-auto mt-6 max-w-md space-y-2 text-lg leading-relaxed text-gray-800">
            {AIML_CLOSE.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <h3 className="mt-10 text-2xl font-bold tracking-tight text-gray-900">{AIML_CLOSE.ctaHeading}</h3>
          <p className="mt-3 text-base text-gray-600">{AIML_CLOSE.finePrint}</p>
          <SectionCta>{AIML_PRODUCT.ctaLabel}</SectionCta>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_GUARANTEE.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-gray-700">{AIML_GUARANTEE.body}</p>
          <div className="mt-8 flex justify-center">
            <Image
              src="/aiml/money-back-guarantee.png"
              alt="100% money-back guaranteed"
              width={560}
              height={560}
              className="h-52 w-52 object-contain sm:h-64 sm:w-64"
            />
          </div>
          <div className="mx-auto mt-10 max-w-2xl">
            <MediaPlaceholder label={AIML_MEDIA_SLOTS.final.label} hint={AIML_MEDIA_SLOTS.final.hint} />
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_CLOSE.finalTitle}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg font-medium leading-relaxed text-gray-800">
            {AIML_CLOSE.finalBody}
          </p>
          <SectionCta>{AIML_CLOSE.finalCta}</SectionCta>
        </div>
      </section>

      <AimlFooter />
      <StickyCheckoutBar />
    </div>
  )
}
