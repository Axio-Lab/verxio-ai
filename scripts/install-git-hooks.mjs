#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, '.githooks', 'pre-commit')

try {
  execSync('git rev-parse --git-dir', { cwd: root, stdio: 'pipe' })
} catch {
  process.exit(0)
}

if (!existsSync(source)) {
  console.warn('[verxio-ai] Missing .githooks/pre-commit — skipping hook install')
  process.exit(0)
}

const hooksDir = execSync('git rev-parse --git-path hooks', { cwd: root, encoding: 'utf8' }).trim()

mkdirSync(hooksDir, { recursive: true })
copyFileSync(source, join(hooksDir, 'pre-commit'))
chmodSync(join(hooksDir, 'pre-commit'), 0o755)

console.log('[verxio-ai] Installed git pre-commit hook (npm run format:check)')
