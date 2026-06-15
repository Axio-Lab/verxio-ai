import './styles.css'

import { QueryClientProvider } from '@tanstack/react-query'

import { installWebBridge } from '@/platform/install-web-bridge'

installWebBridge()
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './app'
import { PublicNotepadShareView } from './app/notepad'
import { ErrorBoundary } from './components/error-boundary'
import { HapticsProvider } from './components/haptics-provider'
import { VerxioAuthGate } from './components/verxio-auth-gate'
import { I18nProvider } from './i18n'
import { installClipboardShim } from './lib/clipboard'
import { queryClient } from './lib/query-client'
import { ThemeProvider } from './themes/context'

installClipboardShim()

function normalizeLegacyHashRoute() {
  const hashRoute = window.location.hash.match(/^#(\/.*)$/)?.[1]

  if (!hashRoute) {
    return
  }

  window.history.replaceState(null, '', hashRoute)
}

normalizeLegacyHashRoute()

function isPublicNotepadShareRoute() {
  return window.location.pathname.startsWith('/share/notepad/')
}

// Dev-only: install __PERF_DRIVE__ + __PERF_PROBE__ on window so the
// scripts/ harnesses can drive a synthetic stream + record render cost.
// Tree-shaken out of production builds. (Uses MODE rather than DEV because
// our Vite setup currently bundles with PROD=true even in `vite dev`; see
// scripts/dev-no-hmr.mjs for the surrounding workarounds.)
if (import.meta.env.MODE !== 'production') {
  import('./app/chat/perf-probe')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="root">
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <HapticsProvider>
              <BrowserRouter>
                {isPublicNotepadShareRoute() ? (
                  <PublicNotepadShareView />
                ) : (
                  <VerxioAuthGate>
                    <App />
                  </VerxioAuthGate>
                )}
              </BrowserRouter>
            </HapticsProvider>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
