/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: true
  },
  trailingSlash: true,
  // Paystack POSTs to /api/paystack/webhooks. A slash redirect would drop the body.
  skipTrailingSlashRedirect: true
}

export default nextConfig
