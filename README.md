# Verxio AI

Verxio is a hosted web product surface for Hermes Agent. Hermes remains the runtime. Verxio owns users, workspaces, runtime lifecycle, proxying, and artifact previews.

## Layout

- `hermes-agent/` - upstream Hermes Agent clone
- `verxio-api/` - FastAPI control plane with Turso/libSQL auth, workspaces, runtime registry, and artifacts
- `verxio-web/` - Verxio browser UI built from the Hermes desktop/web surface
- `verxio-desktop/` - Electron shell that reuses `verxio-web` and enables native desktop bridge APIs
- `.verxio/` - local runtime state, Hermes homes, workspaces, and artifacts

Hermes upstream stays untouched. Verxio changes live in `verxio-api`, `verxio-web`, and `verxio-desktop`.

## Production Shape

Each workspace agent gets one isolated Hermes runtime container:

```text
.verxio/runtimes/{workspace_id}/{agent_id}/hermes-home
.verxio/runtimes/{workspace_id}/{agent_id}/workspace
.verxio/runtimes/{workspace_id}/{agent_id}/workspace/artifacts
```

Turso stores Verxio control-plane metadata only: users, sessions, workspaces, agents, runtime instances, artifacts, and audit events. Hermes memory, sessions, skills, cron jobs, MCP config, gateway connections, and `SOUL.md` remain inside that agent's Hermes home.

## Local Docker Parity

Local Docker uses the same routes, auth flow, database schema, and runtime registry as production. The only difference is where containers run.

```bash
cp .env.verxio.example .env
# Fill TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.

docker compose -f docker-compose.verxio.yml --profile image build hermes-runtime-image verxio-api verxio-web
docker compose -f docker-compose.verxio.yml up verxio-api verxio-web
```

For first local testing without Turso, set these in `.env` before `up`:

```bash
VERXIO_DATABASE_MODE=sqlite
VERXIO_RUNTIME_DOCKER_ROOT=/Users/donatusprince/Desktop/projects/verxio-ai/.verxio/runtimes
VERXIO_RUNTIME_CONNECT_HOST=host.docker.internal
VERXIO_RUNTIME_PUBLISH_HOST=127.0.0.1
```

`verxio-api` is pinned to `linux/amd64` in compose because Turso's `libsql` package has no prebuilt `linux/arm64` wheel. On Apple Silicon that avoids a long Rust/cmake source build during local Docker setup.

Open:

```text
http://127.0.0.1:8080
```

Signup creates a user, personal workspace, default Verxio agent, runtime registry row, isolated Hermes home, workspace, and artifact directory.

## Local Dev Without Docker Compose

```bash
cd verxio-api
VERXIO_DATABASE_MODE=sqlite uv run uvicorn app.main:app --reload --port 8787
```

```bash
cd verxio-web
VITE_VERXIO_API_ENABLED=true VITE_VERXIO_API_URL=http://127.0.0.1:8787 npm run dev
```

Open `http://127.0.0.1:5180`.

## Verxio Desktop

The desktop shell uses the same Verxio Web renderer, but provides a native
`window.hermesDesktop` bridge so desktop-only UI, including the right sidebar
file browser and terminal, is available on macOS, Windows, and Linux.

Start `verxio-api` first, then run the desktop app locally:

```bash
npm run desktop:dev
```

This starts `verxio-web` on `http://127.0.0.1:5180` and launches Electron
against it. The local build smoke check is:

```bash
npm run desktop:build
```

To create an unpacked installable app directory for the current platform, run:

```bash
npm run desktop:pack
```

Platform-specific unsigned installers are available from `verxio-desktop`:

```bash
npm run dist:mac --prefix verxio-desktop
npm run dist:win --prefix verxio-desktop
npm run dist:linux --prefix verxio-desktop
```

Desktop keeps local bridge state on the user's machine, including the local
Leash identity, remembered folder grants, terminal access, and file preview
permissions.

## Verxio Notepad

`/notepad` is the internal Granola-style meeting workspace. Users can create
notes, edit transcripts and summaries, organize notes into folders, delete
records, and create public share URLs that can be viewed without signing in.

On web, Notepad provides the same notes, folders, editing, AI summary, and
public sharing flows. In the desktop app it additionally supports bot-free
recording: Verxio requests device audio where Electron exposes it and falls back
to microphone recording when system audio is unavailable. Transcription uses the
existing Hermes audio transcription route, and AI summaries use the Hermes
runtime already backing Verxio.

## Runtime Flow

1. User logs into Verxio.
2. Verxio resolves their active workspace agent.
3. Verxio API starts the Hermes runtime container on demand.
4. Verxio Web talks to `/api/runtime/dashboard/*`.
5. Verxio API proxies REST and WebSocket traffic to the correct runtime dashboard.
6. Hermes writes generated files to `/workspace/artifacts`.
7. Verxio indexes artifact metadata in Turso and serves preview/download URLs.

## Verification

```bash
npm run ci
npm run desktop:pack
```
