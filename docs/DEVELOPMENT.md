# Development

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Electron app (electron-vite; needs an Electron binary). |
| `pnpm dev:browser` | Engine as a Node process + renderer in a browser over the dev bridge. |
| `pnpm devbridge` | Just the WebSocket dev bridge (used by E2E and `dev:browser`). |
| `pnpm build` | Build the desktop app. |
| `pnpm typecheck` | `tsc --noEmit` across every package. |
| `pnpm lint` | ESLint over apps, packages, tests and scripts. |
| `pnpm format` / `format:check` | Prettier. |
| `pnpm test` | Vitest unit/integration tests. |
| `pnpm test:py` | Python worker tests (needs `ai-worker/.venv`). |
| `pnpm test:e2e` | Playwright in Chromium against the real engine. |
| `pnpm audit:ui` | Static "no dead buttons" + i18n audit. |
| `pnpm verify:models` | Real self-test of every installed model. |
| `pnpm fixtures` | Generate synthetic test media with FFmpeg. |

## Layout rules

- The renderer imports only `@sevenvid/core` and `@sevenvid/ipc` — **never** `@sevenvid/engine`.
- The engine never imports React.
- All main↔renderer communication goes through the typed IPC contract in `packages/ipc`
  (`invoke`/`subscribe`). Add a channel there first; its zod schema is the source of truth.
- Every heavy operation runs through the task system; every outbound request runs through the
  `NetworkGateway`; every gated feature is registered in the Capability Registry.

## Adding a feature end to end

1. **core** — if it needs new domain types or a timeline command, add them in `packages/core` with a unit
   test (commands must be undoable via immer patches).
2. **ipc** — add the channel/event schema in `packages/ipc/src/contract.ts` (and payload schemas in
   `schemas.ts`).
3. **engine** — implement the service, register a task kind for anything heavy, register a capability if
   the feature can be unavailable, and add an integration test that renders/measures a real result.
4. **renderer** — add the screen/control. Use `<Button action="…">` (never an empty `onClick`) and wrap
   gated features in `<CapabilityGate id="…">`. Add both English and Arabic i18n keys.
5. Run `pnpm typecheck && pnpm lint && pnpm audit:ui && pnpm test`, then the relevant E2E spec.

## The dev bridge

`packages/engine/src/devbridge` serves the exact IPC contract over a WebSocket, so the same renderer and
the same engine used in production can run in a browser. Playwright uses it to drive real
import → edit → AI command → render → export → verify flows without Electron (see `tests/playwright.config.ts`).

## Verification-by-measurement

Nothing reports success without proof. Masks measure Laplacian variance inside the region before/after;
audio enhancement measures loudness (`ebur128`); exports re-probe and fully decode the output; AI
operations re-read the document. When you add a feature, add its measurement too.

## Conventions

- TypeScript strict everywhere; prefer pure functions in `core`.
- Errors are `AppError` with a stable code, a user-message key (ar/en) and recovery hints.
- Keep `en.json` and `ar.json` at key parity (`pnpm audit:ui` enforces it).
- Logs are structured (pino) with `module`/`operation`/`durationMs`/`status`.
