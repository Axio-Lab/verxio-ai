const fs = require('node:fs')
const path = require('node:path')

const source = path.resolve(__dirname, '../../verxio-web/dist')
const target = path.resolve(__dirname, '../build/renderer')
const index = path.join(source, 'index.html')

if (!fs.existsSync(index)) {
  console.error(`[verxio-desktop] Missing web renderer build: ${index}`)
  process.exit(1)
}

fs.rmSync(target, { force: true, recursive: true })
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.cpSync(source, target, { recursive: true })

console.log(`[verxio-desktop] Synced renderer: ${source} -> ${target}`)
