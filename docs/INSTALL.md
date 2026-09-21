# Installation

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 22.13 | The engine uses the built-in `node:sqlite`. |
| pnpm | 10.x | `corepack enable` picks up the pinned version. |
| FFmpeg + FFprobe | ≥ 6.0 | With `libx264/libx265/libsvtav1/libaom/libvpx/libass`. Found via `SEVENVID_FFMPEG_PATH`, bundled `resources/bin/<platform>-<arch>/`, or the system `PATH`. |
| Python | ≥ 3.10 | Optional, for AI models (vision, speech, generation). The app runs without it; those capabilities show as `needs-runtime`. |

### System libraries

- **espeak-ng** — always-available TTS voice for subtitles and the Creator.
- **Noto fonts (Arabic)** — correct Arabic shaping in burned-in subtitles and storyboard cards.
- **libEGL / libGLESv2 (Linux)** — required by MediaPipe (object detection, segmentation, landmarks).
  On Debian/Ubuntu: `sudo apt-get install libegl1 libgles2`. Without them MediaPipe models fail to load
  (see `docs/TROUBLESHOOTING.md`).

On Debian/Ubuntu, a complete set:

```bash
sudo apt-get install ffmpeg espeak-ng fonts-noto-core libegl1 libgles2
```

## From source

```bash
git clone https://github.com/moathkleap/7vid.git
cd 7vid
corepack enable
pnpm install
pnpm build            # or: pnpm dev  (Electron)  /  pnpm dev:browser  (no Electron)
```

`pnpm dev` runs the Electron app. `pnpm dev:browser` runs the real engine as a Node process and the
renderer in a normal browser over the dev bridge — useful when an Electron binary is unavailable.

## Python AI worker (optional but recommended)

```bash
python3 -m venv ai-worker/.venv
ai-worker/.venv/bin/pip install -e "ai-worker[vision,audio,stt,tts,test]"
```

The app detects `ai-worker/.venv` automatically in development. In a packaged build, use
**AI Models → Set up runtime**, which creates a managed virtual environment and installs the extras you
approve (the sizes are shown first).

## AI models

Models are **not** bundled. Open **AI Models** in the app to download the ones you need; each download is
resumable, checksum-verified (sha256) and installed into `<userData>/models/<id>` (override with
`SEVENVID_MODELS_DIR`). Every model has a **Test** button that runs a real inference on a bundled sample.
The registry — with sizes, checksums, VRAM/RAM needs and licences — is in
`packages/engine/src/models/registry.ts`. See `docs/AI_MODELS.md`.

Verify installed models from the command line:

```bash
pnpm verify:models
```

## Packaging a desktop build

```bash
pnpm --filter @sevenstudios/desktop package   # electron-vite build && electron-builder
```

Configuration is in `apps/desktop/electron-builder.yml` (Windows nsis, macOS dmg, Linux AppImage/deb).
Before a release build, optionally place static FFmpeg binaries in `resources/bin/<platform>-<arch>/`
(see `resources/bin/README.md`) and app icons in `apps/desktop/build-resources/`.
