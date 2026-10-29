# Verxio

Verxio is an AI-native workspace for agents. Slack is a workspace for teams. Verxio is a workspace for agents, and it is built for doing work.

A company plugs its agents into one place. Those agents share one operational context: the state of the work, the rules the company already decided, the tools that hold the record, and the history of what the last run changed. A task starts from that context. The result is written back into it. The next person on the team, and the next agent they plug in, starts from the updated record.

As the business works, the context gets sharper and execution gets more efficient. That is the self-improving core. The following step is to fine-tune on those operational traces so the model learns this company's work, not only a general checkpoint.

## What the workspace does

- **One context for every agent.** Jobs, files, decisions, follow-ups, and connected tools live in the workspace. Agents do not each start from a blank chat.
- **Work, not a transcript.** The agent reads the operation, uses the connected tools, and writes the outcome back to the system of record.
- **A team can plug in.** Anyone on the team uses the same operational context. The record compounds across people and agents.
- **The model is swappable.** The workspace stays. The model is a setting. This project runs NVIDIA Nemotron 3 Ultra. Other NVIDIA open models can be selected in the same menu.
- **Tools the business already uses.** Airtable and the rest of the connected apps go through Composio. Live web research uses Tavily.

Verxio Web is the browser workspace. Verxio Desktop is the native app: local files, a terminal, and the same agent. Messaging channels can reach that same workspace.

## NVIDIA Nemotron on Nebius Token Factory

Workspace turns run on **NVIDIA Nemotron 3 Ultra**:

`nvidia/nemotron-3-ultra-550b-a55b`

Ultra is the model for operational work. It reads the shared context, calls tools, and writes the result back. Smaller NVIDIA open models stay available in the model menu for shorter turns.

**Nebius Token Factory** serves that model. Token Factory is an OpenAI-compatible inference API. Each agent turn in the workspace is a chat completion against Token Factory, so the desktop app does not host a GPU. That is where Token Factory accelerates the workflow: research, tool calls, and the write-back are Nemotron completions served by Token Factory.

The desktop agent talks to Token Factory through the Hermes NVIDIA provider. On macOS the env file is:

`~/Library/Application Support/Verxio/hermes-home/.env`

```bash
NVIDIA_API_KEY=<Nebius Token Factory API key>
NVIDIA_BASE_URL=https://api.tokenfactory.us-central1.nebius.com/v1
```

`NVIDIA_BASE_URL` is required. Without it, the NVIDIA provider calls NVIDIA's own API at `https://integrate.api.nvidia.com/v1`, which is a different host and does not meet the Token Factory requirement.

In `~/Library/Application Support/Verxio/hermes-home/config.yaml`:

```yaml
model:
  provider: nvidia
  default: nvidia/nemotron-3-ultra-550b-a55b
```

Create the Token Factory key in the [Nebius Token Factory console](https://tokenfactory.nebius.com/). Restart the desktop app after saving the env file. Hermes reads it at startup.

**Other Nebius services.** This project uses Token Factory for inference. It does not deploy on Nebius Serverless Jobs, Serverless Endpoints, or DevPods.

**Tavily.** When a task needs a public source that is not already in the workspace, the agent searches with Tavily. Put `TAVILY_API_KEY` in the same env file. Tavily is not a Nebius service.

## Setup

Requirements: Node.js 22 or newer, Python 3.11, and [uv](https://docs.astral.sh/uv/).

Start the API:

```bash
cd verxio-api
VERXIO_DATABASE_MODE=sqlite uv run uvicorn app.main:app --reload --port 8787
```

Start the desktop app from the repo root:

```bash
npm run desktop:dev
```

The UI is at `http://127.0.0.1:5180`. The API is at `http://127.0.0.1:8787`.

Set the Token Factory env vars above, then restart `npm run desktop:dev` so the agent picks them up. In the model menu, select **Nemotron 3 Ultra**.

A local web build check:

```bash
npm run desktop:build
```

## How it is put together

Verxio is the product: accounts, the workspace, the desktop and web apps, and connections to business tools. Hermes is the agent runtime behind that workspace. Users see Verxio.

```text
verxio-api/       FastAPI control plane, auth, inference gateway, Composio
verxio-web/       Web workspace
verxio-desktop/   Electron app. Reuses verxio-web
hermes-agent/     Agent runtime: memory, skills, tools, scheduling
```

Desktop Hermes state, including the model provider and the Token Factory env file, lives in the Electron user-data folder `hermes-home`.

Connected apps are reached through Composio. The agent calls those tools during a task and writes results back into the operational context.

## License

Verxio is open source under the [MIT License](./LICENSE), an OSI-approved license. The license file is at the repository root.
