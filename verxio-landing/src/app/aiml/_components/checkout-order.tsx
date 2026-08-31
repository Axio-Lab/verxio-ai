'use client'

import { useId, useState } from 'react'

import { AIML_ORDER_BUMP, AIML_PRODUCT, formatNgn } from '@/lib/aiml'

export function CheckoutOrder() {
  const bumpId = useId()
  const [addBump, setAddBump] = useState(false)

  const total = AIML_PRODUCT.priceNgn + (addBump ? AIML_ORDER_BUMP.priceNgn : 0)
  const checkoutUrl = addBump ? AIML_ORDER_BUMP.checkoutUrl : AIML_PRODUCT.checkoutUrl

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Order summary</h2>

        <ul className="mt-4 space-y-3">
          <li className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-gray-900">{AIML_PRODUCT.name}</p>
              <p className="mt-1 text-sm text-gray-500">
                {AIML_PRODUCT.skillCount} expert skills
              </p>
            </div>
            <p className="text-base font-semibold text-gray-900">{AIML_PRODUCT.priceLabel}</p>
          </li>
          {addBump ? (
            <li className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-gray-900">{AIML_ORDER_BUMP.name}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {AIML_PRODUCT.fullSkillCount} skills total
                </p>
              </div>
              <p className="text-base font-semibold text-green-700">{AIML_ORDER_BUMP.priceLabel}</p>
            </li>
          ) : null}
        </ul>

        <div className="mt-6 flex items-baseline justify-between border-t border-gray-200 pt-4">
          <span className="text-sm font-medium text-gray-700">Total due today</span>
          <span className="text-2xl font-bold text-gray-900">{formatNgn(total)}</span>
        </div>
      </section>

      <PayButton href={checkoutUrl} total={total} />

      <div
        className={`rounded-2xl border-2 border-dotted border-primary p-5 transition-colors ${
          addBump ? 'bg-primary/[0.04]' : 'bg-white'
        }`}
      >
        <label htmlFor={bumpId} className="flex min-h-11 cursor-pointer items-start gap-3">
          <input
            id={bumpId}
            type="checkbox"
            checked={addBump}
            onChange={(event) => setAddBump(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          />
          <span className="min-w-0 text-sm font-bold text-gray-900">
            {AIML_ORDER_BUMP.checkboxLabel}{' '}
            <span className="whitespace-nowrap">
              <span className="text-red-600 line-through">{AIML_ORDER_BUMP.valueLabel}</span>{' '}
              <span className="font-semibold text-green-700">{AIML_ORDER_BUMP.todayLabel}</span>
            </span>
          </span>
        </label>

        <div className="mt-4 space-y-4 pl-8">
          <p className="text-sm leading-relaxed text-gray-700">{AIML_ORDER_BUMP.lead}</p>
          <p className="text-sm font-medium leading-relaxed text-gray-900">{AIML_ORDER_BUMP.systemsIntro}</p>
          <ul className="space-y-3">
            {AIML_ORDER_BUMP.systems.map((item) => (
              <li key={item.title} className="text-sm leading-relaxed text-gray-700">
                <span className="font-semibold text-gray-900">{item.title}:</span> {item.body}
              </li>
            ))}
          </ul>
          <p className="text-sm leading-relaxed text-gray-700">{AIML_ORDER_BUMP.closer}</p>
        </div>
      </div>

      <PayButton href={checkoutUrl} total={total} />
    </div>
  )
}

function PayButton({ href, total }: { href: string; total: number }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      Get Instant Access Now for {formatNgn(total)}
    </a>
  )
}
