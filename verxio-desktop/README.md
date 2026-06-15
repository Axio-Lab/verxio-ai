# Verxio Desktop

Native desktop shell for the existing Verxio Web UI.

The desktop app loads the same renderer as `verxio-web`, but provides a native
`window.hermesDesktop` bridge before the renderer starts. Because the browser
fallback bridge only marks `window.__VERXIO_WEB__` when no desktop bridge exists,
the desktop build keeps the same UI while enabling the right sidebar, local file
browser, and terminal.

## Local Development

Start the API first:

```bash
cd ../verxio-api
VERXIO_DATABASE_MODE=sqlite uv run uvicorn app.main:app --reload --port 8787
```

Then run the desktop app from the repo root:

```bash
npm run desktop:dev
```

The dev command starts the Vite renderer on `http://127.0.0.1:5180` and launches
Electron against it.

## Existing Renderer

The desktop package does not fork the UI. It reuses `../verxio-web` so web and
desktop routes, layout, sidebar behavior, artifacts, chat, settings, and future
`/notepad` work stay aligned.

## Production Smoke Build

```bash
npm run desktop:build
```

This currently verifies that `verxio-web` builds and that the generated
renderer is copied into `verxio-desktop/build/renderer`.

## Local Packaging

From the repo root:

```bash
npm run desktop:build
npm run pack --prefix verxio-desktop
```

Platform installer commands are available from `verxio-desktop`:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

macOS signing/notarization and Windows Authenticode signing require external
certificates and CI secrets. The local packaging config is ready for unsigned
developer builds; production signing should be enabled when those credentials
are available.
