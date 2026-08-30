import Image from 'next/image'
import Link from 'next/link'

import { AIML_CHECKOUT_PATH, AIML_PATH, AIML_PRODUCT } from '@/lib/aiml'

export function AimlHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
        <Link href={AIML_PATH} className="flex min-h-10 items-center gap-2">
          <Image src="/logo/verxioIcon.svg" alt="" width={28} height={28} className="h-7 w-7" />
          <span className="text-base font-bold tracking-tight text-gray-900">{AIML_PRODUCT.name}</span>
        </Link>
        <Link
          href={AIML_CHECKOUT_PATH}
          className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Get Instant Access
        </Link>
      </div>
    </header>
  )
}
