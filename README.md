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

In the model menu, select **Nemotron 3 Ultra**.

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

Desktop Hermes state lives in the Electron user-data folder `hermes-home`.

Connected apps are reached through Composio. The agent calls those tools during a task and writes results back into the operational context.

## License

Verxio is open source under the [MIT License](./LICENSE), an OSI-approved license. The license file is at the repository root.
