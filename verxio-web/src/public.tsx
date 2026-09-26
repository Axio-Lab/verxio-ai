import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { PublicAgentShareView } from './app/agents'
import { PublicNotepadShareView } from './app/notepad'
import { ErrorBoundary } from './components/error-boundary'
import { installStaleChunkReload } from './lib/stale-chunk'

installStaleChunkReload()

const downloadCtaClassName =
  'inline-flex min-h-14 w-full max-w-md items-center justify-center gap-2 rounded-xl bg-primary px-6 py-5 text-center text-lg font-black uppercase tracking-wide text-white transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:min-h-16 sm:max-w-xl sm:px-8 sm:text-2xl'

function DownloadPage() {
  return (
    <div className="flex min-h-dvh items-center bg-white text-gray-900">
      <main className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-16 text-center sm:px-8">
        <p className="text-base font-black uppercase tracking-[0.2em] text-primary sm:text-xl">Verxio Desktop</p>
        <h1 className="mt-5 text-5xl font-black leading-[0.95] tracking-tight text-gray-900 sm:text-7xl lg:text-8xl">
          Your AI agent lives on your machine.
        </h1>
        <a className={`mt-10 ${downloadCtaClassName}`} href="https://github.com/Axio-Lab/verxio-ai/releases">
          Download Verxio
          <svg aria-hidden="true" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24">
            <path
              d="M7 17 17 7M9 7h8v8"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />
          </svg>
        </a>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="public">
      <BrowserRouter>
        <Routes>
          <Route element={<PublicNotepadShareView />} path="/share/notepad/*" />
          <Route element={<PublicAgentShareView />} path="/agent/*" />
          <Route element={<DownloadPage />} path="/download" />
          <Route element={<Navigate replace to="/download" />} path="*" />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
