# Verxio platform structure: Hermes runtime first

Verxio is currently focused on becoming the main product surface for a local Hermes Agent runtime.

The first version should feel like using Hermes, but with a Verxio interface:

- one primary Verxio assistant
- Hermes as the runtime
- Hermes model/provider config
- Hermes tools, skills, memory, MCP servers, chat gateways, cron jobs, and self-improvement loop
- a cleaner Verxio web/API surface for runs, status, setup, and future product workflows

## Current decision

Build Verxio as a skin and control surface over Hermes before adding domain-specific agent modules.

That means Verxio should not fork or modify the upstream Hermes repo. The local clone stays updateable:

```text
verxio-ai/
  hermes-agent/       upstream Hermes Agent clone
  verxio-api/         Verxio web/API skin
  .verxio/            local generated runtime state, ignored by git
```

## Runtime ownership

Hermes owns:

- model/provider selection
- API/provider authentication
- skills
- tools
- MCP servers
- memory
- chat gateway connections
- cron/scheduled jobs
- session behavior
- run events
- approval behavior
- self-improvement features

Verxio owns:

- web interface
- local API wrapper
- runtime health display
- run submission
- run polling
- recent run history
- Hermes metadata display
- local development gateway startup

## Model setup

Verxio does not choose the underlying LLM yet.

Verxio sends runs to the Hermes API server using the API model alias:

```json
{
  "model": "hermes-agent"
}
```

Hermes then resolves the real provider and model from the active Hermes config. Use Hermes itself to change that config:

```bash
cd hermes-agent
uv --directory . --project . run python -m hermes_cli.main model
```

When Verxio later grows a setup screen, it should either:

- call Hermes' existing dashboard model endpoints, or
- shell out to the Hermes CLI in a controlled local setup flow.

## Chat gateways

Hermes gateway configuration remains a Hermes responsibility.

Verxio should surface the gateway state from the Hermes API server, especially:

- `/health/detailed`
- `/v1/capabilities`
- configured platform health
- missing-auth errors

The first Verxio version only needs to show whether the Hermes gateway is reachable and which gateway platforms are currently active.

## Cron jobs

Hermes already exposes cron job state through the gateway API:

- `GET /api/jobs`
- `POST /api/jobs`
- `PATCH /api/jobs/{job_id}`
- `DELETE /api/jobs/{job_id}`
- pause, resume, and run endpoints

The first Verxio version should list jobs and show count/status. A later version can add job creation and editing using those Hermes endpoints.

## First product milestone

The immediate milestone is not a new agent system. It is:

1. Start Verxio.
2. Verxio starts or connects to the local Hermes API server.
3. The page clearly shows Hermes runtime health.
4. A user sends a message through Verxio.
5. Hermes handles the actual assistant loop.
6. Verxio polls and renders the run result.

If the model/provider account is missing, expired, or rate-limited, Verxio should show that clearly and point back to Hermes setup.

## Future setup milestones

After the runtime surface works reliably:

- add live SSE run events
- add Hermes session browsing
- add model setup using Hermes dashboard/CLI pathways
- add gateway setup/status screens
- add cron job management
- add self-improvement/profile controls
- then add specialized Verxio modules on top of the working runtime
