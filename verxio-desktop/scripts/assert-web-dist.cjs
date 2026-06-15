const fs = require('node:fs')
const path = require('node:path')

const dist = path.resolve(__dirname, '../../verxio-web/dist')
const index = path.join(dist, 'index.html')

if (!fs.existsSync(index)) {
  console.error(`[verxio-desktop] Missing renderer build: ${index}`)
  process.exit(1)
}

console.log(`[verxio-desktop] Renderer build ready: ${index}`)
