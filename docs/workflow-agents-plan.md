# Workflow Agents Plan

This plan covers reusable Verxio agents that run on the same Hermes runtime for a workspace.

## Execution Model

- Use option A for the MVP: reusable agent profiles run on the same Hermes runtime.
- Do not create a separate runtime per agent until scale, isolation, or enterprise controls require it.
- Treat sessions as conversation/history surfaces.
- Treat agents as persistent worker definitions with instructions, skills, knowledge, tool permissions, integrations, triggers, approvals, and runs.
- Keep Pulse separate from this workflow-agent system.

## Route Model

- Keep the main sidebar clean with one Agents entry for this feature.
- Put all agent setup under the Agents route.
- Agent setup sections should live inside the route as tabs or local navigation:
  - Overview
  - Instructions
  - Skills
  - Knowledge
  - Tools
  - Integrations
  - Triggers
  - Runs
  - Settings

## Capabilities

- Agents may attach existing Verxio/Hermes skills.
- Agents may attach one or more custom knowledge bases for industry/domain context.
- Tools should come from existing Verxio/Hermes tools.
- Integrations should come from existing connected integrations, including Composio.
- Store per-agent allowlists for tools and integrations so agents only use what the user enabled.

## Trigger Plan

- Start with manual and webhook triggers.
- Add schedules after the first execution loop is solid.
- Add app events after integration event support is available.
- Trigger payloads should create durable agent runs with input, status, output, and error records.

## Implementation Phases

1. Data model and API: `workflow_agents`, `workflow_triggers`, `workflow_runs`.
2. Agent route shell: list, create, edit, empty/loading/error states.
3. Manual run MVP: create a run from the UI and execute through Hermes oneshot.
4. Webhook trigger MVP: signed endpoint, trigger matching, run creation.
5. Skills/tools/integrations allowlists: attach existing capabilities.
6. Knowledge base MVP: upload/index/attach/retrieve bounded context.
7. Run history: inspect status, inputs, outputs, errors, and timestamps.
