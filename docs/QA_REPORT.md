# QA report

An honest account of what has been verified, and how. Status legend:

- ✅ **verified here** — exercised by an automated test or a real run in the build environment.
- ⏭️ **requires user machine** — correct code path, but needs a resource the build sandbox lacks (a large
  model, a GPU, or an Electron binary); written to run and verify on a developer/user machine.
- ❌ **not implemented** — surfaced in the UI as unavailable; not faked.

## Automated gates (last run in this environment)

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ clean, all packages |
| `pnpm lint` | ✅ 0 warnings |
| `pnpm audit:ui` | ✅ 195 controls, 642 translation keys resolve, en/ar at parity, no dead buttons |
| `pnpm test` (Vitest) | ✅ 112 unit/integration tests in 24 files |
| `pnpm test:py` (pytest) | ✅ 8 worker tests |
| `pnpm test:e2e` (Playwright) | ✅ 16 specs — 15 passing, 1 (screenshot capture) skipped |
| `pnpm verify:models` | ✅ 10 passed / 0 failed / 0 skipped of 10 installed (needs `libEGL1`+`libgles2` for the MediaPipe models) |

## By area

### Foundation
- ✅ Projects: create/open/save, versions, autosave, crash-recovery journal (session tests).
- ✅ Tasks: queue, progress, pause/resume/cancel, interrupted-on-restart.
- ✅ SQLite (WAL, FTS5), migrations, repositories.
- ✅ Errors (`AppError` + codes), structured logs, diagnostics bundle.
- ✅ Hardware detection; capability registry drives UI gating.

### Editing, media and export
- ✅ Import/analyse (ffprobe, thumbnails, waveform, proxy), library with tags/favourites/search, honest
  failure for a bad file.
- ✅ Timeline commands (cut/split/trim/ripple, speed/reverse/freeze, transforms, aspect/platform presets),
  undo/redo, live preview.
- ✅ RenderGraphCompiler renders validated files; **export matrix** MP4/MOV/WebM × H.264/H.265/AV1/VP9 ×
  resolution, each validated by full decode + dimensions + codec.
- ✅ Hardware encoders offered only after a real one-second test encode, with software fallback.
- ✅ Disk-space estimate + precheck; out-of-space → `DISK_FULL` with the partial file removed.

### Audio, subtitles, OCR, vision
- ✅ Silence detection/removal (measured), loudness, enhancement with before/after numbers.
- ✅ Subtitles SRT/VTT/ASS (re-parsed), burn-in with Arabic shaping (libass).
- ✅ OCR Arabic + English (real recognition on rendered text).
- ✅ Face detection (YuNet), tracking (VitTrack), face embedding (SFace), object detection (MediaPipe,
  with libEGL) — all validated by `verify:models` and worker tests.
- ✅ Privacy masks (blur/pixelate/box) with **measured** verification (Laplacian variance before/after).
- ⏭️ Speech-to-text (faster-whisper) — needs a Whisper model.

### Assistant and Creator
- ✅ Deterministic bilingual intent parser (full unit coverage); plan → apply → verify against the real
  document; honest gating of missing-model operations; conversation UI.
- ✅ Creator: brief → deterministic script → characters → storyboard cards → eSpeak voiceover → assembly
  onto the editor timeline → review; honest **animatic** mode.
- ⏭️ Assistant/Creator with a text model (Qwen/Ollama/Anthropic) or real image/video generation — needs
  the model or provider.

### Models and providers
- ✅ Registry with sha256, resumable gated downloads, per-model real tests, hardware-fit recommendations.
- ✅ External providers (Anthropic / OpenAI-compatible / Ollama) contract-tested against a local mock;
  gated + logged network; API keys encrypted with the OS keychain (`safeStorage`) and never returned.
- ✅ Person segmentation (`vision.segmentation`, selfie-segmenter) and 478-point face landmarks
  (face-landmarker) run real inference in the worker and pass their `verify:models` self-test; exposed as
  `WorkerService.segmentPerson` / `faceLandmarksImage`. A background-blur render and a landmark-based
  precise face mask are the natural UI features to build on them next.

### Cross-cutting
- ✅ i18n (ar/en) at key parity with full RTL/LTR; dark/light theming.
- ✅ Security: contextIsolation, sandbox, `nodeIntegration:false`, `webSecurity`, strict production CSP,
  `setWindowOpenHandler`/`will-navigate`/`will-attach-webview` guards, gated `openExternal` allowlist, no
  telemetry, secrets via `safeStorage`.
- ✅ Recovery after an unclean shutdown restores the last valid snapshot + journal.
- ✅ Packaging config (`electron-builder.yml`) for Windows/macOS/Linux with hardened-runtime entitlements.
- ⏭️ Full Electron-shell E2E (`pnpm test:e2e:electron`) and a produced installer — need an Electron binary.

## Known limitations
- MediaPipe requires `libEGL1`/`libgles2` on Linux (documented in HARDWARE/TROUBLESHOOTING).
- Person segmentation and face landmarks run and verify at the engine level; the UI features that consume
  them (background blur, landmark-based precise masks) are not built yet.
- GPU-only features (AI upscaling, local image/video generation) and large models are verified on a user
  machine, not in the build sandbox.
