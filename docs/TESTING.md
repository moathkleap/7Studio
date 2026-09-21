# Testing

7vid is built with a "verify by measurement" rule: no feature reports success without proof. The test
suite reflects that — it renders real files and measures them, rather than asserting that a function was
called.

## Layers and commands

| Layer | Command | Covers |
|---|---|---|
| Unit / integration (Vitest) | `pnpm test` | core parsers/builders and the export-size estimator; SQLite, tasks, sessions + crash recovery; media import/analysis; validated FFmpeg renders; masks/audio/OCR/subtitles/vision; the assistant plan→apply→verify; the Creator brief→animatic; providers against a local mock server; the export matrix; disk-space precheck; FFmpeg error classification. |
| Python worker (pytest) | `pnpm test:py` | face/tracking/VAD/audio/TTS/mask-metric inference over stdio (needs `ai-worker/.venv`). |
| End-to-end (Playwright) | `pnpm test:e2e` | navigation, editing + export, privacy tools, the assistant, the Creator animatic and provider config — in Chromium against the **real** engine over the dev bridge. |
| Static UI audit | `pnpm audit:ui` | no dead buttons, no empty handlers, i18n completeness and English/Arabic parity. |
| Model self-tests | `pnpm verify:models` | a real inference per installed model, on the user's machine. |
| Types & lint | `pnpm typecheck`, `pnpm lint` | strict TypeScript, ESLint. |

## Fixtures

`pnpm fixtures` generates synthetic media with FFmpeg (test patterns, tones, silence, rendered Arabic/
English text images, clips in MP4/MOV/MKV/AVI/WebM/M4V, plus a real face image) into
`tests/fixtures/generated`. Tests that need media are guarded with `describe.skipIf(!hasFixtures)` so the
suite still runs where fixtures are absent.

## The export matrix

`packages/engine/src/export/export.matrix.test.ts` renders a small timeline across the container × codec ×
resolution matrix (MP4/MOV/WebM × H.264/H.265/AV1/VP9), and validates each output by measurement: real
file, streams, duration within tolerance, exact dimensions and fps, and a full error-free decode. A codec
whose encoder is absent from the FFmpeg build is skipped honestly.

## The dev bridge (E2E)

Playwright starts the real engine as a Node process and the renderer in Chromium, connected over the
WebSocket dev bridge (`tests/playwright.config.ts`), so E2E exercises the same code paths as the packaged
app — import → edit → AI command → render → export → verify — without needing an Electron binary.

## Sandbox limitations (honest)

Some checks require resources a locked-down CI/build sandbox lacks, and are written to run on a developer
or user machine instead — they are never reported as passing when they did not run:

- **Electron-shell E2E** (`pnpm test:e2e:electron`) needs an Electron binary.
- **Large models** (Whisper, Piper, GGUF LLMs, SDXL, Wan) are hosted where the sandbox is blocked;
  `pnpm verify:models` tests whatever is installed.
- **MediaPipe** needs `libEGL`/`libGLESv2` (see `docs/HARDWARE.md`).
- **GPU** features are marked skipped (not passed) when no GPU is present.
