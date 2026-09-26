import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { PublicAgentShareView } from './app/agents'
import { PublicNotepadShareView } from './app/notepad'
import { ErrorBoundary } from './components/error-boundary'
import { installStaleChunkReload } from './lib/stale-chunk'

installStaleChunkReload()

function DownloadPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-sky-600">Verxio Desktop</p>
      <h1 className="text-4xl font-semibold tracking-tight">The agent lives on your machine.</h1>
      <p className="text-base text-muted-foreground">
        Download Verxio Desktop for chat, files, and Whisper. Cron, messaging, and workflow agents keep running in the
        cloud while your Mac is off. Shared notes stay at this host.
      </p>
      <a
        className="inline-flex w-fit rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white"
        href="https://github.com/Axio-Lab/verxio-ai/releases"
      >
        Download Verxio
      </a>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="public">
      <BrowserRouter>
        <Routes>
          <Route path="/share/notepad/*" element={<PublicNotepadShareView />} />
          <Route path="/agent/*" element={<PublicAgentShareView />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="*" element={<Navigate replace to="/download" />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
