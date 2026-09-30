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
    default: 'Verxio — AI work OS',
    template: '%s | Verxio'
  },
  description:
    'Verxio is an AI work OS for your machine. The agent uses your screen, files, terminal, Notepad, connected apps, and messaging channels.',
  keywords: [
    'AI work OS',
    'desktop AI agent',
    'computer use',
    'AI workspace',
    'on-device Whisper',
    'WhatsApp',
    'Telegram',
    'Slack',
    'Discord'
  ],
  authors: [{ name: 'Verxio' }],
  creator: 'Verxio',
  publisher: 'Verxio',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Verxio',
    title: 'Verxio — AI work OS',
    description: 'A workspace on your machine where the agent does the work.',
    images: [
      {
        url: `${siteUrl}/logo/verxioLogoMain.svg`,
        width: 1200,
        height: 630,
        alt: 'Verxio — AI work OS'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Verxio — AI work OS',
    description: 'A workspace on your machine where the agent does the work.',
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
