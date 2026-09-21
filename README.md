# Seven Studios

**Seven Studios** is a local-first desktop application for AI-assisted video editing and AI video creation.
Every operation runs on your machine by default; cloud providers are optional, opt-in and clearly labeled.

> **الوصف بالعربية:** Seven Studios تطبيق سطح مكتب يعمل محلياً أولاً لتحرير الفيديو وتوليده بالذكاء الاصطناعي.
> كل العمليات تعمل على جهازك افتراضياً؛ المزوّدون السحابيون اختياريون ويُفعَّلون صراحةً مع تنبيه واضح.
> خطة البناء الكاملة (المعمارية، خريطة الوحدات، قاعدة البيانات، المزوّدون، خارطة الطريق) في [`docs/PLAN.ar.md`](docs/PLAN.ar.md).

## Status

The application is being built in eight phases (see `docs/PLAN.ar.md`). Features that belong to a later
phase are shown in the interface as explicitly **not available** — nothing is simulated.

| Phase | Scope | Status |
|---|---|---|
| 1 | Application shell, navigation, i18n (ar/en, RTL), projects, versions, crash recovery, tasks, errors, logs, hardware detection, capability registry, dev bridge | ✅ |
| 2 | Media import/analysis, library, timeline, preview, basic editing, render compiler, export | ✅ |
| 3 | Audio, subtitles, OCR, face/object detection, masking, tracking (Python AI worker) | ✅ |
| 4 | AI assistant, command planner, execution and validation engine | ✅ |
| 5 | AI Video Creator (brief → script → characters → storyboard → voice → animatic → assembly → review) | ✅ |
| 6 | AI model manager, external provider registry, network gateway, hardware recommendations | ✅ |
| 7 | Export center, quality validation, disk-space checks, diagnostics | ✅ |
| 8 | QA audit, performance, security review, packaging, documentation | ✅ |

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

## What works today (verified by tests)

- **Editing:** multi-track timeline, cut/split/trim/ripple, speed/reverse/freeze, transforms, aspect and platform presets, live preview, rendered preview, validated export.
- **Privacy masks:** face detection (YuNet), tracking (OpenCV CSRT with face re-detection), blur/pixelate/box masks with rectangular or elliptical shape, keyframed with `sendcmd` in the FFmpeg render graph, plus a **measured verification** (Laplacian variance or block-mean error inside the mask, before vs. after) so a mask is never reported as applied without proof.
- **Audio:** silence detection (Silero VAD when installed, FFmpeg `silencedetect` otherwise), silence removal with re-detection as verification, loudness measurement (`ebur128`), enhancement presets and a rendered before/after comparison with real numbers.
- **Subtitles:** SRT/WebVTT import, SRT/WebVTT/ASS export verified by re-parsing, burn-in with Arabic shaping (libass), cue and style editing. Speech recognition runs through faster-whisper once a Whisper model is installed.
- **On-screen text:** OCR (Tesseract, Arabic + English) per sampled frame, linked into text regions, text extraction and text masks.
- **AI assistant:** a deterministic bilingual (Arabic/English) command parser turns a request into a validated plan of operations, shows it step by step with feasibility, asks a clarifying question when a request is ambiguous (“make it a minute” → trim which end, or slow down), applies it through the same undoable timeline commands and engine tasks, and **verifies every step** against the document (duration changed, mask added, effect present, cues generated). Operations that need a missing model or runtime are shown as not runnable with the reason, never faked. A local or cloud text model can widen understanding but never bypasses the schema or the verification.
- **Enhancement:** looks (color presets), Lanczos upscaling with output validation, AI upscaling gated on a Vulkan GPU runtime, before/after split comparison.
- **Models & runtime:** model registry with checksums, downloads through the privacy-aware network gateway (resumable, logged), real per-model tests on bundled samples, Python runtime detection and setup.

- **AI Video Creator:** an idea becomes a structured brief, then a deterministic first-draft **script** (hook, beats, call to action) with no language model required — fully editable, and a text model can rewrite it when configured. Characters carry a bible and voice, and are linked into the scenes that mention them. It renders a real **storyboard card** per scene (Arabic shaped by libass), synthesizes **voiceover** with eSpeak NG, and **assembles** cards, voice and subtitles onto the same editor timeline so every editing tool applies to the result. With no image/video generation model installed it produces an honest **animatic**, clearly labelled — never a fake “generated” video. A final **review** reports empty scenes, duration drift and character inconsistency (SFace) honestly.

- **External providers:** an opt-in registry of text providers (Anthropic, any OpenAI-compatible endpoint, and local Ollama). Every request goes through the privacy-aware `NetworkGateway` — nothing leaves the machine unless external processing is enabled — and is logged. Keys are stored with the OS keychain when available (Electron safeStorage) and never returned to the interface. Configuring a provider makes the assistant's `llm.text` and subtitle **translation** capabilities available; the model manager, sha256 registry, resumable downloads and per-model tests from earlier phases round out the models & runtime surface.

- **Export center & diagnostics:** the full export matrix — MP4/MOV/WebM containers × H.264/H.265/AV1/VP9 codecs × any resolution/fps — is rendered and then **validated by measurement** (real file, streams, duration within tolerance, exact dimensions and fps, and a full error-free decode pass), covered by a matrix test that renders and checks every supported combination. Hardware encoders (NVENC/QSV/AMF/VideoToolbox/VAAPI) are only offered after a real one-second test encode, with automatic software fallback at render time. Before an export starts, an **estimate** of the output size is shown next to the free disk space and the export is refused up front when it would not fit; an out-of-space failure mid-render is reported honestly as a disk-full error (and the partial file is removed) rather than a generic failure. A **Diagnostics** panel streams live logs, errors, the task history and the network log, and exports a single **diagnostics bundle** (system info, settings, capabilities, tasks, errors, network log and rotated log files) as a zip. Crash recovery restores the last valid project snapshot and journal on the next launch.

- **Publish for social platforms:** a Publish screen reframes the finished project to each platform's exact canvas — YouTube & Shorts, TikTok, Instagram Reels/Post/Story, Facebook, X and LinkedIn — with crop or fit, trims to the platform's duration limit, and exports a **ready-to-upload package**: the correctly-sized video plus a thumbnail, a caption with normalized hashtags, and a metadata file, all **validated by measurement**. It formats and packages locally; it does not post to accounts, so nothing leaves the machine. A package can also carry a **suggested trending sound** as advisory metadata (written to `metadata.json` and `sound.txt`): a copyrighted platform sound is never downloaded or embedded — it is added from within the platform at upload time — while a **cleared alternative** (royalty-free or user-owned) can be picked from the local music library and embedded honestly.

- **Trends:** an opt-in **trend sync** (off by default, through the privacy-aware network gateway) fetches trend templates — formats, captions, hooks, hashtags and a suggested sound — from a JSON feed and stores them as `trend` templates alongside the built-in ones; a stable id means a re-sync updates rather than duplicates. Only trend metadata is fetched; no copyrighted audio is ever downloaded. The local **music library** (`resources/music` and `<userData>/music`, described by sidecar JSON and verified to exist on disk) provides cleared alternatives, matched by mood and tags. A cleared track can be **mixed into the export** as a background bed at a level you control (dB), and **local music generation** (MusicGen through the Python worker, gated on the `gen.music` capability) can create a new cleared track into the library — shown as not available with the reason when the runtime or model is missing, never faked.

Capabilities that need a model, a runtime or hardware this machine lacks are shown as such in the interface, with the reason and the next step.

## Development

```bash
pnpm install
pnpm dev             # Electron app (requires the Electron binary; downloaded by npm on install)
pnpm dev:browser     # Engine + renderer in a normal browser (no Electron needed)
pnpm fixtures        # synthetic test media (FFmpeg; speech samples need espeak-ng)
pnpm test            # unit and integration tests (vitest)
pnpm test:py         # Python worker tests (needs ai-worker/.venv)
pnpm test:e2e        # end-to-end tests in Chromium against the real engine
pnpm typecheck && pnpm lint
```

### Python AI worker (development)

```bash
python3 -m venv ai-worker/.venv
ai-worker/.venv/bin/pip install -e "ai-worker[vision,audio,stt,tts,test]"
```

The application detects `ai-worker/.venv` automatically in development; packaged builds create their own
environment from **AI Models → Set up runtime**. Models are installed into `<userData>/models/<id>` (or
`SEVENSTUDIOS_MODELS_DIR`); the registry with sizes, checksums and hardware requirements lives in
`packages/engine/src/models/registry.ts`.

FFmpeg/FFprobe are located from `SEVENSTUDIOS_FFMPEG_PATH`, the bundled `resources/bin/<platform>-<arch>/`
directory, or the system `PATH`.

## Privacy

- No telemetry. The setting exists only to show that it cannot be enabled.
- No hidden network calls: every outbound request goes through the network gateway and is logged.
- Original media files are never modified.

## Documentation

| Doc | Contents |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Processes, packages, data flow, storage, rendering |
| [INSTALL](docs/INSTALL.md) | Prerequisites, from-source setup, Python worker, packaging |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | Commands, layout rules, adding a feature, the dev bridge |
| [AI_MODELS](docs/AI_MODELS.md) | Model registry, install/test, families, what is not yet implemented |
| [HARDWARE](docs/HARDWARE.md) | CPU/GPU/RAM/disk requirements, encoders, MediaPipe on Linux |
| [TROUBLESHOOTING](docs/TROUBLESHOOTING.md) | Common errors and fixes |
| [PROVIDERS](docs/PROVIDERS.md) | External providers, key storage, adding a provider |
| [TESTING](docs/TESTING.md) | Test layers, fixtures, the export matrix, sandbox limits |
| [QA_REPORT](docs/QA_REPORT.md) | What is verified, requires a user machine, or not implemented |

The full Arabic build plan is in [docs/PLAN.ar.md](docs/PLAN.ar.md).
