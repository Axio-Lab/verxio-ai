import Link from 'next/link'

import { AIML_DISCLAIMER } from '@/lib/aiml'

const year = new Date().getFullYear()

export function AimlFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <p className="text-center text-sm text-gray-500">
          Copyright {year} |{' '}
          <Link
            href="/"
            className="rounded hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Verxio.xyz
          </Link>{' '}
          |{' '}
          <Link
            href="/terms-of-service"
            className="rounded hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Terms &amp; Conditions
          </Link>
        </p>
        <div className="space-y-4 text-xs leading-relaxed text-gray-500 sm:text-sm">
          <p>
            {AIML_DISCLAIMER.facebook} {AIML_DISCLAIMER.results}
          </p>
          <p>{AIML_DISCLAIMER.guarantees}</p>
          <p>{AIML_DISCLAIMER.legal}</p>
          <p>{AIML_DISCLAIMER.facebookRepeat}</p>
        </div>
      </div>
    </footer>
  )
}
