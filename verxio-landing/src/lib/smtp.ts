import nodemailer from 'nodemailer'

function smtpPort(): number {
  return Number.parseInt(process.env.VERXIO_SMTP_PORT || '587', 10)
}

function smtpTls(): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env.VERXIO_SMTP_TLS || 'true').trim().toLowerCase())
}

export function smtpConfigured(): boolean {
  return Boolean(process.env.VERXIO_SMTP_HOST?.trim() && process.env.VERXIO_SMTP_FROM?.trim())
}

function usesResendHttp(host: string): boolean {
  return host.toLowerCase().includes('resend.com')
}

async function sendWithResendHttp(options: {
  to: string
  subject: string
  text: string
  html?: string
  from: string
}): Promise<void> {
  const apiKey = (process.env.VERXIO_SMTP_PASSWORD || '').trim()
  if (!apiKey) {
    throw new Error('VERXIO_SMTP_PASSWORD is required to send through Resend.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: options.from,
      to: [options.to],
      subject: options.subject,
      text: options.text,
      html: options.html,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Resend rejected the AIML email (${response.status}): ${detail}`)
  }
}

export async function sendPlainEmail(options: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<void> {
  const from = process.env.VERXIO_SMTP_FROM?.trim() || ''
  const host = process.env.VERXIO_SMTP_HOST?.trim() || ''

  if (!from || !host) {
    throw new Error('SMTP is not configured on the landing app.')
  }

  if (usesResendHttp(host)) {
    await sendWithResendHttp({ ...options, from })
    return
  }

  const transporter = nodemailer.createTransport({
    host,
    port: smtpPort(),
    secure: smtpPort() === 465,
    requireTLS: smtpTls() && smtpPort() !== 465,
    auth: process.env.VERXIO_SMTP_USERNAME
      ? {
          user: process.env.VERXIO_SMTP_USERNAME,
          pass: process.env.VERXIO_SMTP_PASSWORD || '',
        }
      : undefined,
  })

  await transporter.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  })
}
