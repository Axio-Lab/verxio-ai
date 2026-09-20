import { AIML_SUPPORT_EMAIL, AIML_TELEGRAM_URL } from '@/lib/aiml'
import { appPath } from '@/lib/site'

export const AIML_WEBHOOK_PATH = '/api/paystack/webhooks'

export const AIML_LIBRARY_DRIVE_URL =
  'https://drive.google.com/drive/folders/1Ddn3zIAe3fQKxNWKAi2wKRlt6lQalyaJ?usp=sharing'
export const AIML_FULL_DRIVE_URL =
  'https://drive.google.com/drive/folders/1oqSYOpBgebWy0nbk5-2GYIcc_slC5aM7?usp=drive_link'

const KOBO = 100

export type AimlFulfillmentProduct = {
  key: 'library' | 'full'
  amountKobo: number
  amountNgn: number
  name: string
  skillLabel: string
  driveUrl: string
  subject: string
}

export const AIML_FULFILLMENT_PRODUCTS: readonly AimlFulfillmentProduct[] = [
  {
    key: 'library',
    amountKobo: 17500 * KOBO,
    amountNgn: 17500,
    name: 'AI Money Library',
    skillLabel: '120 skills',
    driveUrl: AIML_LIBRARY_DRIVE_URL,
    subject: 'Your AI Money Library access is ready',
  },
  {
    key: 'full',
    amountKobo: 25000 * KOBO,
    amountNgn: 25000,
    name: 'full AI Money Library',
    skillLabel: '320 skills',
    driveUrl: AIML_FULL_DRIVE_URL,
    subject: 'Your full AI Money Library access is ready',
  },
]

export function productForAmountKobo(amountKobo: number): AimlFulfillmentProduct | null {
  return AIML_FULFILLMENT_PRODUCTS.find((product) => product.amountKobo === amountKobo) ?? null
}

function signupInviteCode(): string {
  return (process.env.VERXIO_SIGNUP_INVITE_CODE || '').trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#00a8e0;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:20px;text-decoration:none;padding:14px 22px;border-radius:8px;">${escapeHtml(label)}</a>`
}

export function buildAimlFulfillmentEmail(
  product: AimlFulfillmentProduct,
  firstName?: string,
): {
  subject: string
  text: string
  html: string
} {
  const greeting = firstName?.trim()
    ? `${firstName.trim()}, thank you for your purchase.`
    : 'Thank you for your purchase.'
  const invite = signupInviteCode()
  const signupUrl = appPath('/signup')
  const telegramUrl = AIML_TELEGRAM_URL
  const intro =
    product.key === 'full'
      ? 'You are in. You bought the full AI Money Library with the extra addon. Here is exactly what happens next.'
      : 'You are in. Here is exactly what happens next.'
  const accessLine =
    product.key === 'full'
      ? 'You bought the full AI Money Library with this email. Save this message. The Drive folder above is your complete library.'
      : 'You bought AI Money Library with this email. Save this message. The Drive folder above is your library.'

  const text = [
    greeting,
    '',
    intro,
    '',
    `Your ${product.name} (${product.skillLabel})`,
    'Download here:',
    product.driveUrl,
    '',
    'STEP 1. JOIN THE TELEGRAM',
    'This is the first thing you must do.',
    telegramUrl,
    '',
    'STEP 2. THIS EMAIL IS YOUR ACCESS',
    accessLine,
    '',
    'STEP 3. USE THE PRODUCT',
    'Drag and drop the skills into ChatGPT, Claude, Gemini, or any AI agent. That is how you start using the library immediately.',
    '',
    'STEP 4. SIGN UP ON VERXIO',
    'You can also sign up and use the Verxio operator platform.',
    signupUrl,
    ...(invite ? [`Invite code: ${invite}`] : []),
    '',
    'STEP 5. NEED HELP?',
    `Any issue? Email ${AIML_SUPPORT_EMAIL} for support or any clarification.`,
    '',
    'Thank you,',
    'Verxio',
  ].join('\n')

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td align="center" style="padding:24px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;color:#111111;">
                <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#00a8e0;">AI Money Library</p>
                <h1 style="margin:0 0 16px;font-size:32px;line-height:1.15;font-weight:800;">THANK YOU FOR YOUR PURCHASE</h1>
                <p style="margin:0 0 24px;font-size:18px;line-height:1.5;font-weight:700;">${escapeHtml(greeting)} ${escapeHtml(intro)}</p>

                <p style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:800;">Your ${escapeHtml(product.name)} (${escapeHtml(product.skillLabel)})</p>
                <p style="margin:0 0 20px;">${button(product.driveUrl, 'Download your library')}</p>

                <p style="margin:0 0 6px;font-size:14px;font-weight:800;color:#00a8e0;">STEP 1</p>
                <h2 style="margin:0 0 8px;font-size:24px;line-height:1.2;font-weight:800;">JOIN THE TELEGRAM</h2>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.5;font-weight:700;">This is the first thing you must do.</p>
                <p style="margin:0 0 24px;">${button(telegramUrl, 'Join the Telegram now')}</p>

                <p style="margin:0 0 6px;font-size:14px;font-weight:800;color:#00a8e0;">STEP 2</p>
                <h2 style="margin:0 0 8px;font-size:24px;line-height:1.2;font-weight:800;">THIS EMAIL IS YOUR ACCESS</h2>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;font-weight:700;">${escapeHtml(accessLine)}</p>

                <p style="margin:0 0 6px;font-size:14px;font-weight:800;color:#00a8e0;">STEP 3</p>
                <h2 style="margin:0 0 8px;font-size:24px;line-height:1.2;font-weight:800;">USE THE PRODUCT</h2>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;font-weight:700;">Drag and drop the skills into ChatGPT, Claude, Gemini, or any AI agent. That is how you start using the library immediately.</p>

                <p style="margin:0 0 6px;font-size:14px;font-weight:800;color:#00a8e0;">STEP 4</p>
                <h2 style="margin:0 0 8px;font-size:24px;line-height:1.2;font-weight:800;">SIGN UP ON VERXIO</h2>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.5;font-weight:700;">You can also sign up and use the Verxio operator platform.${invite ? ` Invite code: ${escapeHtml(invite)}.` : ''}</p>
                <p style="margin:0 0 24px;">${button(signupUrl, 'Sign up on Verxio')}</p>

                <p style="margin:0 0 6px;font-size:14px;font-weight:800;color:#00a8e0;">STEP 5</p>
                <h2 style="margin:0 0 8px;font-size:24px;line-height:1.2;font-weight:800;">NEED HELP?</h2>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;font-weight:700;">Any issue? Email <a href="mailto:${escapeHtml(AIML_SUPPORT_EMAIL)}" style="color:#00a8e0;font-weight:800;">${escapeHtml(AIML_SUPPORT_EMAIL)}</a> for support or any clarification.</p>

                <p style="margin:0;font-size:16px;line-height:1.5;font-weight:700;">Thank you,<br>Verxio</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return {
    subject: product.subject,
    text,
    html,
  }
}
