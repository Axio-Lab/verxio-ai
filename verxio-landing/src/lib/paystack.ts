import { createHmac, timingSafeEqual } from 'node:crypto'

const PAYSTACK_API = 'https://api.paystack.co'

export type PaystackChargeData = {
  id?: number
  status?: string
  reference?: string
  amount?: number
  currency?: string
  customer?: {
    email?: string
    first_name?: string
    last_name?: string
  }
}

export type PaystackWebhookEvent = {
  event?: string
  data?: PaystackChargeData
}

export function paystackSecretKey(): string {
  return (process.env.PAYSTACK_SECRET_KEY || '').trim()
}

export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  const secret = paystackSecretKey()
  if (!secret || !signature) {
    return false
  }

  const digest = createHmac('sha512', secret).update(rawBody).digest('hex')
  const expected = Buffer.from(digest)
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackChargeData> {
  const secret = paystackSecretKey()
  if (!secret) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured.')
  }

  const response = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Paystack verify failed (${response.status})`)
  }

  const payload = (await response.json()) as { status?: boolean; data?: PaystackChargeData }
  if (!payload.status || !payload.data) {
    throw new Error('Paystack verify returned an empty transaction.')
  }

  return payload.data
}
