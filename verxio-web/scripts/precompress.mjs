#!/usr/bin/env node
// Pre-compress the built static assets so nginx can serve them with
// `gzip_static` / `brotli_static` instead of compressing on every request.
//
// Level-9 gzip and level-11 brotli at build time beat nginx's on-the-fly
// level 5 by 15–25% on JS, and cost the origin zero CPU per request. Brotli
// files are consumed by the CDN / ingress (nginx:alpine has no brotli module
// but ingress-nginx and CloudFront do); the in-image nginx serves the .gz.
//
// Usage: node scripts/precompress.mjs dist

import { promises as fs } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.argv[2] || 'dist'
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.txt', '.xml', '.wasm', '.map'])
const MIN_BYTES = 1024

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

let files = 0
let saved = 0

for await (const file of walk(root)) {
  const ext = path.extname(file)

  if (!COMPRESSIBLE.has(ext)) {
    continue
  }

  const source = await fs.readFile(file)

  if (source.length < MIN_BYTES) {
    continue
  }

  const gz = zlib.gzipSync(source, { level: 9 })
  const br = zlib.brotliCompressSync(source, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length
    }
  })

  await Promise.all([fs.writeFile(`${file}.gz`, gz), fs.writeFile(`${file}.br`, br)])
  files += 1
  saved += source.length - gz.length
}

console.log(`[precompress] ${files} files, gzip saved ${(saved / 1024 / 1024).toFixed(1)} MiB`)
