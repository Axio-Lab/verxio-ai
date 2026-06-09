# Verxio Web Deploy

Verxio Web is the browser product surface. It should talk to Verxio API, not directly to a user's laptop or raw Hermes dashboard.

## Build

```bash
npm ci
VITE_VERXIO_API_ENABLED=true VITE_VERXIO_API_URL= npm run build
```

Output: `dist/`

With an empty `VITE_VERXIO_API_URL`, the app uses same-origin `/api`. This is the production default when nginx/Caddy routes `/api` to `verxio-api`.

## Docker

The included `Dockerfile` builds the app and serves it through nginx. `nginx.conf` proxies `/api` and `/static` to the `verxio-api` service, including WebSocket upgrades for Hermes dashboard traffic.

```bash
docker compose -f ../docker-compose.verxio.yml build verxio-web
docker compose -f ../docker-compose.verxio.yml up verxio-web
```

Open:

```text
http://127.0.0.1:8080
```

## Local Vite

```bash
VITE_VERXIO_API_ENABLED=true VITE_VERXIO_API_URL=http://127.0.0.1:8787 npm run dev
```

Open `http://127.0.0.1:5180`.

## Direct Hermes Debug Mode

Use this only when intentionally bypassing Verxio API:

```bash
HERMES_DASHBOARD_URL=http://127.0.0.1:9119 npm run dev
```

That mode is useful for comparing against upstream Hermes, but it is not the hosted Verxio production shape.
