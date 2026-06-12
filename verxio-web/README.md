# Verxio Web

Browser product UI for Verxio, adapted from the Hermes desktop surface.

## Architecture

```text
Browser
  -> Verxio API /api
  -> authenticated runtime proxy
  -> isolated Hermes runtime container
  -> tools, memory, skills, MCP, cron, gateways, model providers
```

Hosted Verxio always uses Verxio API (`VITE_VERXIO_API_ENABLED=true`).

## Local development

Start the API:

```bash
cd ../verxio-api
VERXIO_DATABASE_MODE=sqlite uv run uvicorn app.main:app --reload --port 8787
```

Start the web app:

```bash
npm install
VITE_VERXIO_API_ENABLED=true VITE_VERXIO_API_URL=http://127.0.0.1:8787 npm run dev
```

Open `http://127.0.0.1:5180`.

## Production build

```bash
npm ci
VITE_VERXIO_API_ENABLED=true VITE_VERXIO_API_URL= npm run build
```

Output: `dist/`. With an empty `VITE_VERXIO_API_URL`, the app uses same-origin `/api` (nginx proxies `/api` to `verxio-api`).

## Docker

```bash
docker compose -f ../docker-compose.verxio.yml build verxio-web
docker compose -f ../docker-compose.verxio.yml up verxio-web
```

Open `http://127.0.0.1:8080`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build |
| `npm run type-check` | TypeScript verification |
| `npm run lint` | ESLint |
| `npm run test:ui` | Vitest |

## Direct Hermes debug mode

Bypass Verxio API only when comparing against upstream Hermes:

```bash
VITE_VERXIO_API_ENABLED=false VITE_HERMES_DASHBOARD_URL=http://127.0.0.1:9119 npm run dev
```
