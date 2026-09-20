# Architecture

7vid is a local-first desktop application built as a pnpm monorepo. It has two modules — an **AI Video
Editor** and an **AI Video Creator** — over one shared timeline document and one engine.

## Processes

```
┌──────────────────────── Electron ────────────────────────┐
│  Renderer (React 19)      Preload (contextBridge)         │
│  packages/core + ipc  ──►  window.sevenvid.{invoke,        │
│                            subscribe}                      │
│                                   │ ipcRenderer            │
│  Main process ◄───────────────────┘                       │
│  packages/engine (Node): SQLite, tasks, FFmpeg, AI        │
│         │                    │                             │
│         ▼                    ▼                             │
│   FFmpeg/FFprobe        Python AI worker (JSON-RPC/stdio)  │
└───────────────────────────────────────────────────────────┘
```

- **Renderer** (`apps/desktop/src/renderer`) is a React 19 + Tailwind v4 + Zustand + i18next app. It never
  imports from `packages/engine`; it talks to the engine only through the typed IPC contract, and uses
  `packages/core` for the domain model and optimistic editing.
- **Preload** (`apps/desktop/src/preload`) exposes exactly two functions — `invoke(channel, input)` and
  `subscribe(event, cb)` — over `contextBridge`. No Node APIs reach the renderer.
- **Main** (`apps/desktop/src/main`) creates the window, installs the CSP, wires the Electron host
  (dialogs, shell, OS keychain) and constructs the engine.
- **Engine** (`packages/engine`) owns all real work: SQLite, projects, the task queue, FFmpeg, the model
  manager, providers and the AI orchestration. It never imports React.
- **Python AI worker** (`ai-worker`) is a JSON-RPC-over-stdio process the engine starts on demand for
  vision, speech and generation models.

## Packages

| Package | Role |
|---|---|
| `packages/core` | Pure TypeScript: the project/timeline document, timeline commands + immer-patch undo/redo, the validator, the bilingual intent parser, number/time parsing, presets and the export-size estimator. Used by both the renderer and the engine. |
| `packages/ipc` | The single source of truth for the IPC surface: every channel and event as a zod schema, with derived types. |
| `packages/engine` | All Node-only services (see below). |
| `apps/desktop` | Electron shell + React renderer. |
| `ai-worker` | Python worker package (`sevenvid_worker`). |

### Engine services (`packages/engine/src`)

`db` (SQLite schema, migrations, repositories, FTS5) · `media` (probe, thumbnails, waveform, proxy,
import) · `ffmpeg` (runner with progress/pause/cancel, locator, encoder test) · `render`
(RenderGraphCompiler, staged renderer, preview renderer) · `export` (presets, encoder probe, size
estimate, post-render validation) · `audio` · `subtitles` · `vision` · `ocr` · `ai` (planner, runner,
verifier, assistant) · `creator` · `providers` (registry, text providers) · `models` (registry,
downloader, tester) · `worker` (Python runtime manager, JSON-RPC client) · `tasks` (queue, scheduler,
pause/resume/cancel, persistence) · `project` (session, autosave, versions, journal, recovery) ·
`hardware` · `capabilities` · `network` (gateway, consent, log) · `errors` · `logging` · `search` ·
`devbridge` (WebSocket host that serves the same IPC contract to a browser for E2E).

## Source of truth and data flow

`ProjectSession` in the engine owns the timeline **document**. The renderer keeps a mirror and edits
optimistically during drags, then commits a `core` command. AI operations and the Creator mutate the
same document through the same undoable commands, so the timeline, preview, subtitles and masks always
stay in sync.

- Every heavy operation goes through the **task system** (`tasks`), which reports real progress and
  supports pause/resume/cancel and post-restart recovery of interrupted tasks.
- Every outbound network request goes through the **NetworkGateway** (`network`), which refuses unless
  the user enabled external processing, and logs host + purpose + bytes.
- The **Capability Registry** (`capabilities`) derives each feature's status
  (`available | needs-model | needs-provider | needs-runtime | needs-hardware | unavailable`) from
  providers, hardware and runtime. The renderer's `<CapabilityGate>` disables a control and explains why,
  so there are no dead buttons (enforced by `pnpm audit:ui`).

## Storage

SQLite (`node:sqlite`, WAL, FTS5) holds projects, versions, assets, transcripts, AI conversations/plans/
operations, characters, scripts, scenes, models, provider config, settings, tasks, exports, templates and
the network log. Large or portable data lives in each project's `data_dir`: `project.7vid.json` (portable
mirror), `journal.ndjson` (crash-recovery patches), `tracks/`, `cache/`, `generated/`, `exports/`.

## Rendering

`RenderGraphCompiler` turns a document + range + target (proxy/preview/export) into an FFmpeg filtergraph:
trims and speed/reverse/freeze, transforms and aspect strategies, colour/enhance filters, keyframed masks
via `sendcmd`, burned-in ASS subtitles (libass, Arabic-shaped), and a multi-track audio mix. A staged
renderer falls back to per-clip intermediates + `concat` for complex graphs. See `docs/TESTING.md` for how
each path is validated.
