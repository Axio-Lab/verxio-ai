/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VERXIO_API_ENABLED?: string
  readonly VITE_VERXIO_API_URL?: string
  readonly VITE_HERMES_DASHBOARD_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __HERMES_SESSION_TOKEN__?: string
  __VERXIO_WEB__?: boolean
}
