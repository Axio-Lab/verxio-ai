'use client'

import { useId, useState } from 'react'

import { AIML_ORDER_BUMP, AIML_PRODUCT, formatNgn } from '@/lib/aiml'

export function CheckoutOrder() {
  const bumpId = useId()
  const [addBump, setAddBump] = useState(false)
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const total = AIML_PRODUCT.priceNgn + (addBump ? AIML_ORDER_BUMP.priceNgn : 0)

  function payNow() {
    setBusy(true)
    window.setTimeout(() => {
      setBusy(false)
      setSubmitted(true)
    }, 400)
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Preview only</p>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-gray-900">Payment is not connected yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          No charge was made. Total would have been {formatNgn(total)}
          {addBump ? ` (${AIML_PRODUCT.name} + ${AIML_ORDER_BUMP.name})` : ` (${AIML_PRODUCT.name})`}.
        </p>
      </div>
    )
  }

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
              <p className="text-base font-semibold text-gray-900">{AIML_ORDER_BUMP.priceLabel}</p>
            </li>
          ) : null}
        </ul>

        <div className="mt-6 flex items-baseline justify-between border-t border-gray-200 pt-4">
          <span className="text-sm font-medium text-gray-700">Total due today</span>
          <span className="text-2xl font-bold text-gray-900">{formatNgn(total)}</span>
        </div>
      </section>

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
          <span className="text-sm font-bold text-gray-900">
            {AIML_ORDER_BUMP.checkboxLabel}
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

      <button
        type="button"
        onClick={payNow}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {busy ? 'Processing...' : `Get Instant Access Now for ${formatNgn(total)}`}
      </button>
    </div>
  )
}
