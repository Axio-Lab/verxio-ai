'use client'

import { useId, useState } from 'react'
import type { FormEvent } from 'react'

import { AIML_PRODUCT } from '@/lib/aiml'

type FieldErrors = Partial<Record<'name' | 'email' | 'card' | 'expiry' | 'cvc', string>>

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function CheckoutForm() {
  const formId = useId()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [card, setCard] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  function validate(): FieldErrors {
    const next: FieldErrors = {}
    if (!name.trim()) next.name = 'Enter your name.'
    if (!email.trim()) next.email = 'Enter your email.'
    else if (!isValidEmail(email)) next.email = 'Email must include an @ and a domain.'
    if (!card.replace(/\s/g, '')) next.card = 'Enter a card number.'
    if (!expiry.trim()) next.expiry = 'Enter expiry.'
    if (!cvc.trim()) next.cvc = 'Enter CVC.'
    return next
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) {
      const first = Object.keys(next)[0]
      document.getElementById(`${formId}-${first}`)?.focus()
      return
    }

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
        <h2 className="mt-2 text-xl font-bold tracking-tight text-gray-900">Checkout is not connected yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          No charge was made. This page is the checkout structure — we will wire payment and delivery next.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900">Buyer details</legend>
        <div className="space-y-1.5">
          <label htmlFor={`${formId}-name`} className="block text-sm font-medium text-gray-800">
            Full name <span className="text-gray-500">(required)</span>
          </label>
          <input
            id={`${formId}-name`}
            name="name"
            type="text"
            autoComplete="name"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${formId}-name-error` : undefined}
            className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          />
          {errors.name ? (
            <p id={`${formId}-name-error`} className="text-xs text-red-600">
              {errors.name}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${formId}-email`} className="block text-sm font-medium text-gray-800">
            Email <span className="text-gray-500">(required)</span>
          </label>
          <input
            id={`${formId}-email`}
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? `${formId}-email-error` : `${formId}-email-hint`}
            className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          />
          <p id={`${formId}-email-hint`} className="text-xs text-gray-500">
            Access is sent to this address.
          </p>
          {errors.email ? (
            <p id={`${formId}-email-error`} className="text-xs text-red-600">
              {errors.email}
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-900">Payment</legend>
        <div className="space-y-1.5">
          <label htmlFor={`${formId}-card`} className="block text-sm font-medium text-gray-800">
            Card number <span className="text-gray-500">(required)</span>
          </label>
          <input
            id={`${formId}-card`}
            name="card"
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            value={card}
            onChange={(e) => setCard(e.target.value)}
            aria-invalid={Boolean(errors.card)}
            aria-describedby={errors.card ? `${formId}-card-error` : undefined}
            className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          />
          {errors.card ? (
            <p id={`${formId}-card-error`} className="text-xs text-red-600">
              {errors.card}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor={`${formId}-expiry`} className="block text-sm font-medium text-gray-800">
              Expiry <span className="text-gray-500">(required)</span>
            </label>
            <input
              id={`${formId}-expiry`}
              name="expiry"
              type="text"
              autoComplete="cc-exp"
              placeholder="MM/YY"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              aria-invalid={Boolean(errors.expiry)}
              aria-describedby={errors.expiry ? `${formId}-expiry-error` : undefined}
              className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            />
            {errors.expiry ? (
              <p id={`${formId}-expiry-error`} className="text-xs text-red-600">
                {errors.expiry}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${formId}-cvc`} className="block text-sm font-medium text-gray-800">
              CVC <span className="text-gray-500">(required)</span>
            </label>
            <input
              id={`${formId}-cvc`}
              name="cvc"
              type="text"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
              aria-invalid={Boolean(errors.cvc)}
              aria-describedby={errors.cvc ? `${formId}-cvc-error` : undefined}
              className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            />
            {errors.cvc ? (
              <p id={`${formId}-cvc-error`} className="text-xs text-red-600">
                {errors.cvc}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {busy ? 'Processing…' : `Pay ${AIML_PRODUCT.priceLabel}`}
      </button>
      <p className="text-xs text-gray-500">
        Payment is not live yet. Submitting this form will not charge your card.
      </p>
    </form>
  )
}
