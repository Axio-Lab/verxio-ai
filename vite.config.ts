import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const DIRECT_HERMES_BACKEND = process.env.HERMES_DASHBOARD_URL ?? process.env.VITE_HERMES_DASHBOARD_URL
const VERXIO_API_BACKEND = process.env.VITE_VERXIO_API_URL ?? 'http://127.0.0.1:8787'
const BACKEND = DIRECT_HERMES_BACKEND ?? VERXIO_API_BACKEND

function hermesDevToken(): Plugin {
  const TOKEN_RE = /window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/

  return {
    name: 'verxio:hermes-dev-session-token',
    apply: 'serve',
    async transformIndexHtml() {
      if (!DIRECT_HERMES_BACKEND) {
        return
      }

      try {
        const res = await fetch(BACKEND, { headers: { accept: 'text/html' } })
        const html = await res.text()
        const match = html.match(TOKEN_RE)
        if (!match) {
          console.warn(`[verxio] No session token at ${BACKEND}. Run: hermes dashboard --no-open`)
          return
        }
        return [
          {
            tag: 'script',
            injectTo: 'head',
            children: `window.__HERMES_SESSION_TOKEN__="${match[1]}";`
          }
        ]
      } catch (err) {
        console.warn(`[verxio] Dashboard unreachable at ${BACKEND}. (${(err as Error).message})`)
      }
    }
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), hermesDevToken()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hermes/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js')
    },
    dedupe: ['react', 'react-dom']
  },
  build: {
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND, ws: true },
      '/dashboard-plugins': BACKEND
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4180
  }
})
