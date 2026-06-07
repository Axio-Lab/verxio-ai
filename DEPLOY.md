# Verxio Web — Production Deploy

## Build

```bash
npm ci
npm run build
```

Output: `dist/`

## Option A — Serve via Hermes dashboard (recommended)

Point Hermes at the Verxio build:

```bash
export HERMES_WEB_DIST=/absolute/path/to/verxio-web/dist
hermes dashboard --no-open --skip-build --host 127.0.0.1 --port 9119
```

Open `http://127.0.0.1:9119` — Verxio UI + Hermes API on one origin.

## Option B — Static host + API proxy

Serve `dist/` from nginx/Caddy and proxy `/api` to `hermes dashboard`:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:9119;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

Inject `window.__HERMES_SESSION_TOKEN__` in `index.html` at deploy time, or enable dashboard OAuth gate.

## Requirements

- Hermes Agent `hermes dashboard` running (Python 3.11+)
- Provider configured (`hermes setup` or onboarding in Verxio UI)
- For terminal pane: POSIX PTY (macOS/Linux). Windows native dashboard PTY may require WSL.

## Environment

| Variable | Purpose |
|----------|---------|
| `HERMES_DASHBOARD_URL` | Dev proxy target (default `http://127.0.0.1:9119`) |
| `HERMES_WEB_DIST` | Production static bundle path for `hermes dashboard` |
| `VITE_HERMES_DASHBOARD_URL` | Optional explicit API base for web bridge |

## verxio-api

`verxio-api` remains optional for Verxio-specific BFF APIs. Chat uses `hermes dashboard` directly, not the gateway `:8642` polling API.
