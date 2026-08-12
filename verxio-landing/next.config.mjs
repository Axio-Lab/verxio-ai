/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  output: 'export',
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: true
  },
  trailingSlash: true
}

export default nextConfig
