# Verxio Agent Workflows Implementation Plan

This plan extends `/agents` into the single setup route for reusable Verxio workflow agents. It follows `docs/verxio-build-guidebook.md`: related setup stays inside the Agents route, UI uses existing primitives, spinners use `text-primary`, dialogs avoid duplicate close affordances, and every completed phase gets Prettier, CI, and a commit.

## Product Model

Agents are reusable workers that run on the existing Hermes runtime profile model.

- Trigger: what starts the agent.
- Agent run: what the agent does with instructions, model, skills, tools, knowledge, and integrations.
- Delivery: where the result goes after the run.
- Embed/share: public or scoped entry points that can collect input and trigger an agent.
- Runs: execution history, run events, delivery events, errors, approvals, and output.

The Agents route should own all of this:

- Setup Assistant
- Instructions
- Skills
- Knowledge
- Integrations
- Tools
- Triggers
- Delivery
- Embed
- Runs

## Setup Assistant

Agents should support both AI-assisted setup and manual setup.

Inside `/agents`, add a prompt field above or beside the manual form where the user can describe what they want:

> Create a payment delivery agent. Trigger it when Paystack payment succeeds. Send a WhatsApp message to the customer, notify Slack ops, use our delivery policy KB, and ask for approval if confidence is low.

The setup assistant should generate a draft configuration and populate the same editable fields used by manual setup:

- Name
- Role
- Description
- Brain model
- Instructions
- Skills
- Knowledge bases
- Integrations
- Tools
- Triggers
- Delivery rules
- Embed/share settings when requested

The user can then switch to manual setup, edit the generated fields, and save. Generated setup should never silently enable risky external actions. Anything that sends messages, creates public links, uses paid tools, or exposes webhook callbacks should be created disabled or marked as requiring approval until the user confirms.

The setup assistant should also work from a normal Verxio session and, later, from approved messaging gateways such as WhatsApp, Telegram, Slack, and Discord.

Conversational setup flow:

- User describes the agent they want.
- Verxio drafts an agent configuration.
- Verxio asks follow-up questions only for missing critical details.
- Verxio creates or updates the agent after user approval.
- Verxio summarizes what was created, what is still disabled, and which settings need connection or approval.

Allowed conversational setup actions:

- Create agent
- Update agent
- Set instructions
- Select model
- Attach skills
- Create and attach knowledge bases
- Add knowledge documents from user-provided text/files
- Attach integrations
- Attach tools
- Create triggers
- Create delivery rules
- Configure embed/share links
- Enable or disable an agent
- Run a test
- Show run history and setup status

Actions that require explicit approval:

- Enabling external delivery
- Creating public embed/share links
- Sending messages externally
- Adding webhook callbacks
- Using paid or API-key-backed tools
- Changing secrets or API-key-backed tool bindings
- Deleting agents, triggers, deliveries, assets, or knowledge bases
- Enabling broad inbound triggers such as “reply to every WhatsApp message”

Gateway-based setup should be stricter than in-app setup. For example, a WhatsApp request can draft or update safe fields, but broad triggers, public links, destructive actions, and external delivery should require in-app/session approval before activation.

## Trigger Sources

Triggers start agent execution. The UI should present source-oriented choices instead of raw backend types.

- Manual: user clicks Run.
- Webhook/API: external service posts JSON to a generated endpoint.
- Schedule: interval or cron-like scheduled execution.
- Connected app event: Composio app events such as CRM lead created, payment received, form submitted, new email, or spreadsheet row added.
- Messaging gateway: WhatsApp, Telegram, Slack, Discord, email, or other connected channel inbound messages.
- Embed/share form: website widget or public/shareable agent URL submits input.

Every trigger needs:

- Name
- Source type
- Event name
- Enabled state
- Input schema or sample payload
- Optional filters
- Source-specific config JSON stored with a stable version

Messaging triggers require the selected gateway to already be connected. If missing, the UI should show a disabled source with a clear “Connect in Settings” action.

## Delivery

Delivery is separate from triggers. It defines what happens to the result after an agent run.

Delivery options:

- Save only: store run output without sending.
- Reply to source: reply to the same WhatsApp, Telegram, Slack, Discord, email, embed thread, or share session that triggered the run.
- Send message: send output to a selected channel, account, address, phone number, or Slack channel.
- Composio action: send Gmail, update CRM, create ticket, append spreadsheet row, post Slack message, etc.
- Webhook callback: POST run output to a configured URL.
- Approval first: hold delivery until the user approves.

Delivery fields:

- Delivery type
- Channel/integration
- Destination
- Template
- Output mapping
- Enabled state
- Require approval
- Config JSON

Runs should record delivery events:

- delivery_queued
- delivery_waiting_for_approval
- delivery_sent
- delivery_failed

## Embed And Share

Agents should support website embeds and shareable URLs as first-class trigger sources.

Embed capabilities:

- Generate script snippet for user websites.
- Generate iframe option for simple embedding.
- Trigger agent from submitted input.
- Optional conversation mode for back-and-forth answers.
- Required `Powered by Verxio` footer.
- Domain allowlist.
- Rate limits.
- Optional secret/public token.
- Input schema fields.
- File or image upload if enabled by the agent.

Share URL capabilities:

- Public or private share link.
- Optional passcode.
- Optional expiration.
- Optional lead capture fields.
- Same brand configuration as embed.
- Runs agent through an `embed` or `share` trigger type.

Branding configuration:

- Logo asset
- Primary color
- Accent color
- Button style within Verxio visual constraints
- Welcome text
- Placeholder text
- Powered by Verxio footer locked on

Assets:

- Agent logo
- Brand image
- Optional product images or reference assets
- Uploaded files usable by embed/share input when enabled
- Files stored under workspace/agent ownership with size/type validation

## Tools

Bring back the Tools navigation inside the Agents route. Tools are different from integrations:

- Integrations are connected accounts/apps, mostly through Composio.
- Tools are callable capabilities the agent is allowed to use, including Hermes tools, configured toolsets, custom API tools, and media/utility tools.

The Tools tab should:

- List available Hermes/runtime tools from existing metadata.
- List configured toolsets and custom tools from existing Verxio settings.
- Allow attaching tools to an agent allowlist.
- Show missing API keys or missing setup states.
- Link to Settings API keys/tool setup when a tool is unavailable.
- Support custom API tools such as a YouCam API cosmetic consultant tool.

Custom API tool flow:

- User creates or connects a tool in existing Verxio tool/API-key settings.
- User stores API key in the existing tool key system.
- User attaches that tool in the agent Tools tab.
- Agent instructions include the allowed tool and how to use it.
- Runtime execution gets the tool allowlist and credentials through existing Verxio/Hermes infrastructure.

## Messaging Gateway Bridge

Messaging gateways should be valid trigger sources when connected.

Flow:

- Incoming gateway event arrives from WhatsApp, Telegram, Slack, Discord, or email.
- Verxio normalizes it to a workflow event.
- Verxio matches enabled workflow triggers for that channel/event/filter.
- Verxio runs the matching agent.
- Delivery sends the result back to source or configured destinations.

This bridge must stay outside Pulse. Pulse remains a separate product area.

## API Surface

Add or extend API surfaces:

- `POST /api/workflow-agents/draft`
- `POST /api/workflow-agents/{agent_id}/draft-update`
- `GET /api/workflow-agents/{agent_id}/tools`
- `PUT /api/workflow-agents/{agent_id}/tools`
- `GET /api/workflow-agents/{agent_id}/deliveries`
- `POST /api/workflow-agents/{agent_id}/deliveries`
- `PUT /api/workflow-agents/{agent_id}/deliveries/{delivery_id}`
- `DELETE /api/workflow-agents/{agent_id}/deliveries/{delivery_id}`
- `GET /api/workflow-agents/{agent_id}/embed`
- `PUT /api/workflow-agents/{agent_id}/embed`
- `POST /api/workflow-agents/{agent_id}/assets`
- `DELETE /api/workflow-agents/{agent_id}/assets/{asset_id}`
- `POST /api/workflow-agents/public/{public_token}/runs`
- `POST /api/workflow-agents/triggers/messaging`
- `POST /api/workflow-agents/triggers/embed`
- `POST /api/workflow-agents/setup-actions/approve`

Keep Pydantic models explicit and workspace/agent scoping strict.

## Data Model

Add explicit tables instead of hiding durable setup inside JSON-only agent state.

- `workflow_deliveries`
- `workflow_embed_configs`
- `workflow_agent_assets`
- `workflow_public_links`
- `workflow_agent_setup_drafts`
- `workflow_agent_setup_approvals`

Extend trigger support with stable config version fields where needed.

## Phases

### Phase 1: Plan And Guide Alignment

- Add this implementation plan.
- Confirm guidebook consistency.
- Run Prettier and workflow CI check.
- Commit plan.

### Phase 2: Backend Setup Drafts And Approvals

- Add setup draft and approval models, migration, and CRUD helpers.
- Add draft endpoints that accept a user prompt and return structured agent setup fields without saving risky actions silently.
- Add approval records for external delivery, public links, destructive changes, broad messaging triggers, and paid/API-key-backed tools.
- Add API tests for draft persistence, approval scoping, and guarded actions.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:api`, and `npm run ci:web` if generated API types/web clients change.
- Commit phase.

### Phase 3: Agents UI Setup Assistant

- Add prompt field to `/agents` for describing the agent the user wants.
- Generate a draft and populate the manual setup fields.
- Add a clear switch between generated draft review and manual setup.
- Show missing setup states for integrations, tools, gateways, KB, and model.
- Use existing UI primitives, centered primary loaders, and modal dialogs without duplicate X/Cancel controls.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:web`.
- Commit phase.

### Phase 4: Backend Delivery And Run Events

- Add delivery models, migration, CRUD, and run delivery event recording.
- Implement save-only, webhook callback placeholder, and reply-to-source data structures.
- Add API tests for scoped CRUD and run event recording.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:api`, and `npm run ci:web` if generated API types/web clients change.
- Commit phase.

### Phase 5: Agents UI Delivery Tab

- Add Delivery tab inside `/agents`.
- Use existing UI primitives and primary centered loaders.
- Add modal form without duplicate X and Cancel controls.
- Show connected-only destinations and missing setup states.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:web`.
- Commit phase.

### Phase 6: Tools Tab

- Bring back Tools tab inside `/agents`.
- Show Hermes/runtime tool capabilities and custom/API-key-backed tools.
- Attach selected tools to agent allowlist.
- Show setup links for missing keys.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:web`, and backend CI if API changes.
- Commit phase.

### Phase 7: Trigger UX Upgrade

- Replace blank trigger state with guided source cards.
- Add source-specific trigger forms for webhook/API, schedule, app event, messaging gateway, embed/share, and manual.
- Validate connected gateway/app availability before enabling source.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:web`, and backend CI if API validation changes.
- Commit phase.

### Phase 8: Messaging Gateway Trigger Bridge

- Add normalized workflow messaging event handler.
- Wire WhatsApp, Telegram, Slack, Discord, and email gateway events into workflow triggers where available.
- Keep Pulse separate.
- Support reply-to-source delivery metadata.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:api`, `npm run ci:web`.
- Commit phase.

### Phase 9: Embed, Share URL, Branding, And Assets

- Add embed/share models, migrations, CRUD, public run endpoint, and asset upload/delete.
- Add Embed tab with script snippet, iframe snippet, share URL, branding controls, domain allowlist, and upload controls.
- Enforce `Powered by Verxio`.
- Add frontend widget bundle or static embed endpoint.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:api`, `npm run ci:web`.
- Commit phase.

### Phase 10: Composio App Event And Delivery Actions

- Wire connected Composio apps into app-event trigger source options.
- Add delivery actions for email, CRM update, ticket creation, spreadsheet append, and Slack post where connected.
- Record tool/action delivery events.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:api`, `npm run ci:web`.
- Commit phase.

### Phase 11: Conversational And Gateway Setup Tools

- Expose safe agent-management tools to normal Verxio sessions.
- Allow session-based creation/update of agents, triggers, deliveries, tools, KB, embed/share config, and test runs.
- Add stricter gateway setup path for WhatsApp, Telegram, Slack, and Discord requests.
- Require approval for broad triggers, public links, destructive changes, external delivery, and paid/API-key-backed tools.
- Record setup actions in run/activity events where applicable.
- Run `npm run fmt`, `npm run format:check`, `npm run ci:api`, `npm run ci:web`.
- Commit phase.

### Phase 12: End-To-End Verification

- Test payment webhook to WhatsApp delivery.
- Test website embed input to agent run.
- Test share URL run.
- Test Slack/Telegram inbound message trigger where configured.
- Test prompt-generated setup in `/agents`.
- Test session-created agent setup.
- Test gateway-drafted agent setup with in-app approval.
- Test custom API tool agent flow, such as YouCam cosmetic consultant.
- Rebuild Docker and restart Verxio API/web/runtime containers.
- Run full `npm run ci`.
- Commit final polish if needed.

## Example Product Flows

Payment delivery agent:

- Trigger: payment succeeded webhook.
- Agent: inspect order/payment payload and compose delivery update.
- Tools/integrations: CRM, order API, WhatsApp gateway.
- Delivery: send WhatsApp to customer and Slack to ops.

AI cosmetic consultant:

- Trigger: embedded website form with selfie/product preference upload.
- Agent: use knowledge base and YouCam API tool.
- Tools: YouCam custom API tool with stored API key.
- Delivery: reply inside embed and optionally email recommendation.

Lead research agent:

- Trigger: new form submission or CRM lead created app event.
- Agent: research company, score fit, draft message.
- Integrations: CRM, web/research tools, Gmail.
- Delivery: ask approval if confidence is low, then update CRM and draft/send email.

Support agent:

- Trigger: incoming WhatsApp, Slack, Telegram, Discord, or email message.
- Agent: retrieve support KB and decide answer/escalation.
- Delivery: reply to source, create ticket if needed, notify support channel.
