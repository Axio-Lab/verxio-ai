import type { Metadata } from 'next'
import Image from 'next/image'
import { CheckCircle2 } from 'lucide-react'

import { AimlFooter } from './_components/aiml-footer'
import { CheckoutButton } from './_components/checkout-button'
import { CtaArrows } from './_components/cta-arrows'
import { AimlFileVideo, AimlPlayerScript } from './_components/aiml-youtube-video'
import { BeforeAfterVideo } from './_components/before-after-video'
import { ImagePlaceholder } from './_components/image-placeholder'
import { StickyCheckoutBar } from './_components/sticky-checkout-bar'
import { UrgencyCountdown } from './_components/urgency-countdown'
import {
  AIML_BETTER_WAY,
  AIML_CATEGORIES,
  AIML_CHOICE,
  AIML_DIFFERENCE,
  AIML_GUARANTEE,
  AIML_OFFER,
  AIML_PAYOFF,
  AIML_PLACEHOLDERS,
  AIML_PROBLEM,
  AIML_PRODUCT,
  AIML_REALITY,
  AIML_STEPS,
  AIML_TESTIMONIALS,
  AIML_USE_PATHS,
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

export default function AimlSalesPage() {
  return (
    <div className="min-h-screen bg-white pb-28">
      <AimlPlayerScript />
      <div className="sticky top-0 z-40">
        <UrgencyCountdown variant="banner" />
      </div>

      <section className="px-6 pb-16 pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-[2rem] font-bold leading-[1.18] tracking-tight text-gray-900 sm:text-[2.5rem] sm:leading-[1.12] lg:text-5xl">
            {AIML_PRODUCT.headline.split(AIML_PRODUCT.headlineAccent)[0]}
            <span className="text-primary">{AIML_PRODUCT.headlineAccent}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-xl leading-relaxed text-gray-600">{AIML_PRODUCT.tagline}</p>
          <div className="mt-10 text-left">
            <ImagePlaceholder
              label={AIML_PLACEHOLDERS.hero.label}
              idea={AIML_PLACEHOLDERS.hero.idea}
              tall
            />
          </div>
          <div className="mt-8 space-y-4">
            <CtaArrows />
            <div className="flex justify-center">
              <CheckoutButton>Get Instant Access Now for {AIML_PRODUCT.priceLabel}</CheckoutButton>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_REALITY.title}</h2>
          <div className="mt-6 space-y-4">
            {AIML_REALITY.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-lg leading-relaxed text-gray-700">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_PROBLEM.title}</h2>
          <p className="mt-6 text-xl font-semibold leading-relaxed text-gray-900">{AIML_PROBLEM.lead}</p>
          <div className="mt-4 space-y-4">
            {AIML_PROBLEM.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-lg leading-relaxed text-gray-700">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_DIFFERENCE.title}</h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">{AIML_DIFFERENCE.lead}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border border-gray-200 bg-gray-100 p-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                {AIML_DIFFERENCE.beforeLabel}
              </p>
              <p className="mt-3 text-base italic leading-relaxed text-gray-600">“{AIML_DIFFERENCE.beforeQuote}”</p>
              <p className="mt-4 text-base font-medium text-gray-700">{AIML_DIFFERENCE.beforeResult}</p>
            </article>
            <article className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">
                {AIML_DIFFERENCE.afterLabel}
              </p>
              <p className="mt-3 text-base font-medium leading-relaxed text-gray-900">
                “{AIML_DIFFERENCE.afterQuote}”
              </p>
              <p className="mt-4 text-base font-medium text-gray-800">{AIML_DIFFERENCE.afterResult}</p>
            </article>
          </div>
          <div className="mt-6">
            <BeforeAfterVideo />
          </div>
          <p className="mt-6 text-lg font-semibold leading-relaxed text-gray-900">{AIML_DIFFERENCE.closer}</p>
          <SectionCta>See What Expert-Trained AI Can Do</SectionCta>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_BETTER_WAY.title}</h2>
          <div className="mt-6 space-y-4">
            {AIML_BETTER_WAY.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-lg leading-relaxed text-gray-700">
                {paragraph}
              </p>
            ))}
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {AIML_USE_PATHS.map((path, index) => (
              <article
                key={path.title}
                className={
                  index === 0
                    ? 'rounded-2xl bg-gray-900 p-6 text-white'
                    : 'rounded-2xl bg-primary p-6 text-gray-950'
                }
              >
                <p className="text-sm font-semibold">Path {index + 1}</p>
                <h3 className="mt-2 text-2xl font-bold tracking-tight">{path.title}</h3>
                <p
                  className={
                    index === 0
                      ? 'mt-4 text-base leading-relaxed text-white/85'
                      : 'mt-4 text-base leading-relaxed text-gray-900'
                  }
                >
                  {path.body}
                </p>
                <p className="mt-4 text-base font-semibold leading-relaxed">{path.result}</p>
              </article>
            ))}
          </div>
          <h3 className="mt-12 text-2xl font-bold tracking-tight text-gray-900">How to start with one skill</h3>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {AIML_STEPS.map((item) => (
              <li key={item.step}>
                <p className="text-sm font-bold tracking-widest text-primary">{item.step}</p>
                <h3 className="mt-2 text-lg font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-gray-600">{item.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <AimlFileVideo
              src={AIML_PLACEHOLDERS.howItWorks.videoSrc}
              poster={AIML_PLACEHOLDERS.howItWorks.posterSrc}
              title={AIML_PLACEHOLDERS.howItWorks.videoTitle}
            />
          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_CATEGORIES.title}</h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">{AIML_CATEGORIES.lead}</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {AIML_CATEGORIES.groups.map((item) => (
              <li key={item.title} className="rounded-2xl border border-gray-200 bg-white p-6">
                <h3 className="text-lg font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-gray-600">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-lg font-medium text-gray-800">
            Use these skills for your own business. When you can produce a useful result, you can also offer that
            work to other businesses for a fee.
          </p>
        </div>
        <div className="mx-auto mt-12 max-w-4xl">
          <h3 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            What people say after they use it
          </h3>
          <div className="mt-8 space-y-8">
            {AIML_TESTIMONIALS.map((item) => (
              <figure
                key={item.src}
                className="overflow-hidden rounded-3xl border border-gray-200 bg-[#0b1220] shadow-[0_20px_50px_rgba(15,23,42,0.18)]"
              >
                <Image
                  src={item.src}
                  alt={item.alt}
                  width={1024}
                  height={576}
                  className="h-auto w-full object-contain"
                  sizes="(min-width: 896px) 56rem, 100vw"
                />
              </figure>
            ))}
          </div>
          <SectionCta>Get All 120 Expert AI Skills Now</SectionCta>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_PAYOFF.title}</h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">{AIML_PAYOFF.lead}</p>
          <ul className="mt-8 space-y-6">
            {AIML_PAYOFF.items.map((item) => (
              <li key={item.title}>
                <h3 className="text-lg font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-lg leading-relaxed text-gray-700">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 px-6 py-16">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{AIML_OFFER.title}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            {AIML_OFFER.heading}:{' '}
            <span className="text-red-600 line-through">{AIML_OFFER.comparePriceLabel}</span>{' '}
            <span className="text-green-700">{AIML_PRODUCT.priceLabel}</span>
          </h2>
          <p className="mt-3 text-lg italic leading-relaxed text-gray-600">{AIML_OFFER.priceAnchor}</p>
          <p className="mt-6 text-lg font-medium leading-relaxed text-gray-900">{AIML_OFFER.intro}</p>
          <ul className="mt-5 space-y-4">
            {AIML_OFFER.items.map((item) => (
              <li key={item.title} className="flex items-start gap-3 text-lg leading-relaxed text-gray-700">
                <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-semibold text-gray-900">{item.title}:</span> {item.body}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-lg leading-relaxed text-gray-700">{AIML_OFFER.closer}</p>

          <div className="mt-8 border-t border-gray-200 pt-8">
            <h3 className="text-2xl font-bold tracking-tight text-gray-900">{AIML_OFFER.bonusesHeading}</h3>
            <ul className="mt-5 space-y-5">
              {AIML_OFFER.bonuses.map((bonus) => (
                <li key={bonus.label} className="text-lg leading-relaxed text-gray-700">
                  <p>
                    <span className="font-semibold text-gray-900">
                      {bonus.label}: {bonus.title}
                    </span>
                    {bonus.valueLabel ? (
                      <>
                        {' '}
                        <span className="text-red-600 line-through">{bonus.valueLabel}</span>
                        {' '}
                        <span className="font-semibold text-green-700">FREE</span>
                      </>
                    ) : (
                      <>
                        {' '}
                        <span className="font-semibold text-green-700">FREE</span>
                      </>
                    )}
                  </p>
                  <p className="mt-1">{bonus.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-lg font-medium leading-relaxed text-gray-900">
              Total bonus value:{' '}
              <span className="text-red-600 line-through">{AIML_OFFER.bonusesTotal}</span>{' '}
              <span className="font-semibold text-green-700">{AIML_OFFER.bonusesCloser}</span>
            </p>
            <div className="mt-8 space-y-4">
              <UrgencyCountdown variant="inline" />
              <CtaArrows />
              <div className="flex justify-center">
                <CheckoutButton>Get Instant Access Now for {AIML_PRODUCT.priceLabel}</CheckoutButton>
              </div>
            </div>
          </div>
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
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{AIML_CHOICE.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-gray-700">{AIML_CHOICE.body}</p>
          <h3 className="mt-10 text-2xl font-bold tracking-tight text-gray-900">
            Get the AI Money Library: 120 Expert AI Skills for {AIML_PRODUCT.priceLabel}
          </h3>
          <div className="mt-8 space-y-4">
            <CtaArrows />
            <div className="flex justify-center">
              <CheckoutButton>Get Instant Access Now for {AIML_PRODUCT.priceLabel}</CheckoutButton>
            </div>
          </div>
        </div>
      </section>

      <AimlFooter />
      <StickyCheckoutBar />
    </div>
  )
}
