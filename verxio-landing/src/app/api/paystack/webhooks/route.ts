import { NextResponse } from 'next/server'

import { buildAimlFulfillmentEmail, productForAmountKobo } from '@/lib/aiml-fulfillment'
import { verifyPaystackSignature, verifyPaystackTransaction, type PaystackWebhookEvent } from '@/lib/paystack'
import { sendPlainEmail, smtpConfigured } from '@/lib/smtp'

const processedReferences = new Set<string>()

export const runtime = 'nodejs'

export function GET() {
  return NextResponse.json({ service: 'aiml-paystack-webhooks' })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-paystack-signature')

  if (!verifyPaystackSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid Paystack signature' }, { status: 401 })
  }

  let event: PaystackWebhookEvent
  try {
    event = JSON.parse(rawBody) as PaystackWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (event.event !== 'charge.success') {
    return NextResponse.json({ ok: true, ignored: event.event || 'unknown' })
  }

  const reference = event.data?.reference?.trim()
  if (!reference) {
    return NextResponse.json({ error: 'Missing transaction reference' }, { status: 400 })
  }

  if (processedReferences.has(reference)) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  if (!smtpConfigured()) {
    return NextResponse.json({ error: 'SMTP is not configured' }, { status: 503 })
  }

  let verified
  try {
    verified = await verifyPaystackTransaction(reference)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verify failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  if (verified.status !== 'success') {
    return NextResponse.json({ ok: true, ignored: 'unpaid' })
  }

  const amountKobo = Number(verified.amount)
  const product = productForAmountKobo(amountKobo)
  if (!product) {
    console.warn(`[aiml-paystack] Unmapped amount ${amountKobo} for ${reference}`)
    processedReferences.add(reference)
    return NextResponse.json({ ok: true, ignored: 'unmapped-amount', amount: amountKobo })
  }

  const email = verified.customer?.email?.trim()
  if (!email) {
    return NextResponse.json({ error: 'Verified transaction has no customer email' }, { status: 422 })
  }

  const message = buildAimlFulfillmentEmail(product, verified.customer?.first_name)
  try {
    await sendPlainEmail({
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Email send failed'
    console.error(`[aiml-paystack] Email failed for ${reference}: ${detail}`)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }

  processedReferences.add(reference)
  return NextResponse.json({ ok: true, product: product.key, reference })
}
