const fs = require('node:fs')
const path = require('node:path')

const apiUrl = (process.env.VERXIO_API_URL || process.env.VITE_VERXIO_API_URL || 'http://127.0.0.1:8787').replace(
  /\/$/,
  ''
)

const publicWebUrl = (process.env.VITE_VERXIO_PUBLIC_WEB_URL || process.env.VERXIO_PUBLIC_WEB_URL || '').replace(
  /\/$/,
  ''
)

const target = path.join(__dirname, '../electron/runtime-env.json')
const payload = {
  apiUrl,
  publicWebUrl,
  apiEnabled: true
}

fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`[verxio-desktop] Wrote ${target}`)
console.log(`[verxio-desktop] apiUrl=${apiUrl}`)
