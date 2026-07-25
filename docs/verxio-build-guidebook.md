# Verxio Build Guidebook

Use this guide to keep Verxio consistent across the web app, desktop shell, API surfaces, and future product areas. Update it whenever a visual, interaction, or implementation rule becomes reusable across the project.

## Product Surface

- Build actual usable product screens, not marketing-style placeholder pages.
- Keep primary navigation clean and focused. Add a top-level sidebar item only when it represents a durable product area.
- Put related setup, details, history, and settings inside the owning route instead of scattering them across the sidebar.
- Keep collection routes in a clear browse state by default. Show creation or configuration forms only after the user
  explicitly starts creating an item or selects an existing item to edit.
- Use the shared pagination control for growing collections and keep pagination visible with the collection it controls.
- When configuration depends on a saved record, explain the save prerequisite in the relevant section instead of
  rendering a blank panel.
- Prefer clear operational UI: dense enough to scan, restrained in decoration, and predictable for repeated work.
- Match the existing Verxio layout language before introducing a new page pattern.

## Visual System

- Reuse existing UI primitives from `verxio-web/src/components/ui` before creating new components.
- Match existing spacing, typography, borders, shadows, and color tokens.
- Use `text-primary` for active loading spinners and progress indicators.
- Avoid one-off colors. Prefer theme tokens such as `text-primary`, `text-foreground`, `text-muted-foreground`, `border-(--stroke-nous)`, and existing surface variables.
- Keep cards for repeated items, dialogs, and framed tools. Do not wrap whole pages or page sections in nested cards.
- Avoid decorative clutter. UI should feel quiet, capable, and product-focused.

## Loading States

- Show a spinner whenever a user action, route transition, save, connection check, or provider switch is being processed.
- Loading spinners should use Verxio primary color everywhere.
- Full-page, overlay, route, and panel-blocking loading states should center the spinner in the available content area.
- Settings tab changes such as `/settings?tab=socials` and `/settings?tab=providers` should clearly show processing with a primary-color spinner when data is loading or switching.
- Disable only the controls affected by an in-flight action where possible; avoid freezing the whole page unless the whole page is genuinely blocked.
- Preserve layout dimensions during loading so text, buttons, and panels do not jump.

## Dialogs And Popups

- Do not use `window.alert`, `window.confirm`, or browser-native prompts for product UI.
- Use Verxio modal dialogs for confirmations, forms, and destructive actions.
- Do not show both a top-right X close icon and a Cancel button in the same dialog. Prefer the footer Cancel button for forms and confirmations.
- For new dialogs that use a Cancel button, set `showCloseButton={false}` on `DialogContent`.
- Use existing dialog primitives: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, and `DialogFooter`.
- Destructive or irreversible actions should use confirmation dialogs with clear copy and busy states.

## Forms And Controls

- Use existing `Button`, `Input`, `Textarea`, `Select`, `Switch`, `Checkbox`, `Tabs`, and related primitives.
- Use icon buttons for compact actions where an icon is familiar, with accessible labels.
- Use segmented controls or tabs for small mutually exclusive modes.
- Use toggles/switches for binary enabled/disabled state.
- Use selects or menus for bounded option sets.
- Include loading/busy labels for saves, connects, deletes, imports, and runs.
- Keep button text short and make sure it fits on mobile and desktop.

## Data And API Work

- Keep backend changes scoped to the owning module.
- Add Pydantic models for new API surfaces instead of passing loose dictionaries across route boundaries.
- Persist durable product concepts in explicit tables rather than hiding them in session-only state.
- Reuse existing workspace, agent, runtime, and integration ownership patterns.
- Keep user/workspace scoping explicit in queries.
- Store JSON configuration with stable field names and version when it may evolve.

## Integrations And Tools

- Do not create a second integration system when existing Verxio/Hermes/Composio infrastructure can support the feature.
- Store feature-level allowlists or bindings when a product area should restrict which tools or integrations it can use.
- Validate that a connected account or provider exists before presenting an action as ready.
- Show clear setup states for missing credentials, expired connections, and unavailable providers.

## Phase Discipline

- Ship in small phases.
- Commit each completed phase separately.
- Run CI after each completed phase before starting the next phase.
- Prefer focused CI during development, then full CI before a larger merge.
- Avoid unrelated refactors inside feature phases.
- If a formatting hook changes files, rerun the relevant CI against the formatted source before committing.

## Verification

- Run the focused CI target for the surface changed:
  - Web UI: `npm run ci:web`
  - API: `npm run ci:api`
  - Desktop shell: `npm run ci:desktop`
- For cross-surface changes, run the broader relevant combination, and use full `npm run ci` before larger merges.
- Record known unrelated warnings in the handoff instead of silently folding unrelated cleanup into the phase.
