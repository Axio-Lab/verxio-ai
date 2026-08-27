import Image from 'next/image'
import Link from 'next/link'

import { AIML_CHECKOUT_PATH, AIML_PATH, AIML_PRODUCT } from '@/lib/aiml'

export function AimlHeader({ checkout }: { checkout?: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href={AIML_PATH} className="flex items-center gap-2">
          <Image src="/logo/verxioIcon.svg" alt="Verxio" width={32} height={32} className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight text-gray-900">{AIML_PRODUCT.name}</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="hidden px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:inline-flex min-h-10 items-center rounded-lg"
          >
            Verxio home
          </Link>
          {checkout ? (
            <Link
              href={AIML_PATH}
              className="inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Back to sales page
            </Link>
          ) : (
            <Link
              href={AIML_CHECKOUT_PATH}
              className="inline-flex min-h-10 items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Get the library
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
