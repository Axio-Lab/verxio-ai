# Verxio Web

Browser product UI for Verxio, adapted from the Hermes desktop/web surface.

## Architecture

```text
Browser
  -> Verxio API /api
  -> authenticated runtime proxy
  -> isolated Hermes runtime container
  -> tools, memory, skills, MCP, cron, gateways, model providers
```

Direct Hermes dashboard mode still exists for upstream comparison, but hosted Verxio should use Verxio API.

## Local Development

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

Open:

```text
http://127.0.0.1:5180
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build |
| `npm run type-check` | TypeScript verification |
| `npm run lint` | ESLint |
| `npm run test:ui` | Vitest |

## Production

See [DEPLOY.md](./DEPLOY.md).

## Direct Hermes Debug Mode

```bash
HERMES_DASHBOARD_URL=http://127.0.0.1:9119 npm run dev
```

Use this only to compare against the upstream Hermes dashboard.
