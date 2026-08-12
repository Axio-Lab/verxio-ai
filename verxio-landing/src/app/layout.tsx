import type { Metadata } from 'next'
import localFont from 'next/font/local'

import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900'
})

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900'
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.verxio.xyz'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Verxio — Agentic Business Operations Platform',
    template: '%s | Verxio'
  },
  description:
    'Verxio is an agentic operations platform that manages your business end-to-end. Deploy AI agents that orchestrate goals, automate workflows, and run support across WhatsApp, Telegram, Slack, and Discord. 10,000+ actions. 800+ apps. One platform.',
  keywords: [
    'agentic operations platform',
    'AI operations',
    'AI agents',
    'AI automation',
    'AI workflow builder',
    'WhatsApp bot',
    'Telegram bot',
    'Slack bot',
    'Discord bot',
    'business automation'
  ],
  authors: [{ name: 'Verxio' }],
  creator: 'Verxio',
  publisher: 'Verxio',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Verxio',
    title: 'Verxio — Agentic Business Operations Platform',
    description:
      'Deploy AI agents that orchestrate goals, automate workflows, and run support across WhatsApp, Telegram, Slack, and Discord.',
    images: [
      {
        url: `${siteUrl}/logo/verxioLogoMain.svg`,
        width: 1200,
        height: 630,
        alt: 'Verxio — Agentic Business Operations Platform'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Verxio — Agentic Business Operations Platform',
    description:
      'Deploy AI agents that orchestrate goals, automate workflows, and run support across WhatsApp, Telegram, Slack, and Discord.',
    images: [`${siteUrl}/logo/verxioLogoMain.svg`],
    creator: '@verxioprotocol'
  },
  robots: {
    index: true,
    follow: true
  },
  icons: {
    icon: [{ url: '/logo/verxioIcon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/logo/verxioIcon.svg', type: 'image/svg+xml' }],
    shortcut: '/logo/verxioIcon.svg'
  }
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
