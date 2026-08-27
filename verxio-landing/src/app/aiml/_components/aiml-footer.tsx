import Link from 'next/link'

import { AIML_PRODUCT } from '@/lib/aiml'

export function AimlFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-6 py-8 sm:flex-row">
        <p className="text-xs text-gray-400">
          {new Date().getFullYear()} {AIML_PRODUCT.name}
        </p>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <Link
            href="/privacy"
            className="rounded hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Privacy
          </Link>
          <Link
            href="/terms-of-service"
            className="rounded hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Terms
          </Link>
        </div>
      </div>
    </footer>
  )
}
