# 7vid

**7vid** is a local-first desktop application for AI-assisted video editing and AI video creation.
Every operation runs on your machine by default; cloud providers are optional, opt-in and clearly labeled.

> **الوصف بالعربية:** 7vid تطبيق سطح مكتب يعمل محلياً أولاً لتحرير الفيديو وتوليده بالذكاء الاصطناعي.
> كل العمليات تعمل على جهازك افتراضياً؛ المزوّدون السحابيون اختياريون ويُفعَّلون صراحةً مع تنبيه واضح.
> خطة البناء الكاملة (المعمارية، خريطة الوحدات، قاعدة البيانات، المزوّدون، خارطة الطريق) في [`docs/PLAN.ar.md`](docs/PLAN.ar.md).

## Status

The application is being built in eight phases (see `docs/PLAN.ar.md`). Features that belong to a later
phase are shown in the interface as explicitly **not available** — nothing is simulated.

| Phase | Scope | Status |
|---|---|---|
| 1 | Application shell, navigation, i18n (ar/en, RTL), projects, versions, crash recovery, tasks, errors, logs, hardware detection, capability registry, dev bridge | ✅ |
| 2 | Media import/analysis, library, timeline, preview, basic editing, render compiler, export | 🔜 |
| 3 | Audio, subtitles, OCR, face/object detection, masking, tracking (Python AI worker) | 🔜 |
| 4 | AI assistant, command planner, execution and validation engine | 🔜 |
| 5 | AI Video Creator | 🔜 |
| 6 | AI model manager, providers, network gateway | 🔜 |
| 7 | Export center, quality validation, diagnostics | 🔜 |
| 8 | QA audit, performance, security review, packaging, documentation | 🔜 |

## Architecture (short)

```
apps/desktop        Electron shell (main, preload) + React renderer
packages/core       Pure TypeScript domain: project document, timeline commands, undo/redo, validation
packages/ipc        Typed IPC contract (zod) shared by main, preload, renderer and the dev bridge
packages/engine     Node engine: SQLite (node:sqlite), projects, tasks, hardware, FFmpeg, AI orchestration
ai-worker           Python AI worker (JSON-RPC over stdio) for vision, speech and generation models
resources           Fonts, templates, model registry
tests               Playwright end-to-end tests (browser mode + Electron)
```

## Development

```bash
pnpm install
pnpm dev             # Electron app (requires the Electron binary; downloaded by npm on install)
pnpm dev:browser     # Engine + renderer in a normal browser (no Electron needed)
pnpm test            # unit and integration tests (vitest)
pnpm test:e2e        # end-to-end tests in Chromium against the real engine
pnpm typecheck && pnpm lint
```

FFmpeg/FFprobe are located from `SEVENVID_FFMPEG_PATH`, the bundled `resources/bin/<platform>-<arch>/`
directory, or the system `PATH`.

## Privacy

- No telemetry. The setting exists only to show that it cannot be enabled.
- No hidden network calls: every outbound request goes through the network gateway and is logged.
- Original media files are never modified.
