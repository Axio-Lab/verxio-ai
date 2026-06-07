# Verxio Web — Implementation Plan

Port of `hermes-agent/apps/desktop` to a browser-native Verxio product.

**Status: Phases 0–8 complete.**

## Phase 0 — Scaffold ✅

Vite + React + Tailwind shell, dashboard proxy, Axio-Lab repo.

## Phase 1 — Design foundation ✅

- Full desktop `styles.css` + `themes/`
- `i18n/` (Verxio branding in `en.ts`)
- `@nous-research/ui`, ESLint, Prettier
- `@hermes/shared` in `packages/shared/`

## Phase 2 — Gateway client & boot ✅

- `src/platform/install-web-bridge.ts` — browser shim for `window.hermesDesktop`
- WebSocket JSON-RPC via `/api/ws`
- Boot overlay + gateway stores

## Phase 3 — Onboarding ✅

- `DesktopOnboardingOverlay` + `store/onboarding.ts`
- Provider picker, OAuth via `window.open`
- `runtime-readiness.ts`

## Phase 4 — Chat core ✅

- Full `app/chat/`, `desktop-controller.tsx`
- Sessions, composer, streaming tool UI
- `hermes.ts` gateway client

## Phase 5 — Settings & model picker ✅

- `app/settings/`, model picker overlays
- Profile store

## Phase 6 — Previews & file browser ✅

- Preview pane, artifacts (file browser limited on web — `readDir` stub in web bridge)

## Phase 7 — Voice & polish ✅

- Voice playback stores, haptics provider (browser-safe)
- Microphone via `getUserMedia` in web bridge

## Phase 8 — Production ✅

- `npm run build` → `dist/`
- [DEPLOY.md](./DEPLOY.md) — `HERMES_WEB_DIST` + nginx proxy options

## Web vs Desktop differences

| Feature | Desktop | Verxio Web |
|---------|---------|------------|
| Backend boot | Electron spawns Python | User runs `hermes dashboard` |
| Install overlay | Yes | Skipped (`getBootstrapState` inactive) |
| File picker | Native | Browser stub / file input |
| File tree | `readDir` IPC | Stub (future API) |
| Terminal | node-pty | `/api/pty` WebSocket |
| Updates | In-app git pull | `hermes update` on host |

## Syncing upstream desktop

Cherry-pick changes from `hermes-agent/apps/desktop/src/` into matching paths here. Re-apply Verxio branding and web-bridge adaptations.
