# AI models

Models are optional, downloaded on demand, and never bundled. The registry —
`packages/engine/src/models/registry.ts` — lists every model with its id, capability, files + sha256
checksums, size, VRAM/RAM needs, licence and languages. Downloads go through the privacy-aware
`NetworkGateway` (resumable, logged), verify their sha256, and install into `<userData>/models/<id>`
(override with `SEVENVID_MODELS_DIR`).

## Managing models

- **AI Models** screen: install, remove, update, and **Test** each model (a real inference on a bundled
  sample — never a fake pass). Hardware fit (VRAM/RAM) is shown per model from the live hardware snapshot.
- Command line: `pnpm verify:models` runs the real self-test for every installed model and prints a
  passed / failed / skipped report.

## Registry (small, always-local)

These are small and self-contained; they power the editor's vision, OCR and voice-activity features.

| Model | Capability | Size | Notes |
|---|---|---|---|
| opencv/yunet-2023mar | vision.faces | 227 KB | Face detection (default). |
| opencv/sface-2021dec | vision.faceEmbedding | 37 MB | Face embedding for character consistency. |
| opencv/vittrack-2023sep | vision.tracking | 698 KB | Object/face tracking. |
| mediapipe/efficientdet-lite0 | vision.objects | 7 MB | Object detection (needs libEGL/libGLESv2 on Linux). |
| mediapipe/efficientdet-lite2 | vision.objects | 12 MB | Higher-accuracy object detection. |
| tesseract/ara-fast | ocr | 1 MB | Arabic OCR. |
| tesseract/eng-fast | ocr | 4 MB | English OCR. |
| silero/vad-v5 | audio.vad | 2 MB | Voice-activity detection / silence removal. |
| realesrgan/x4plus | upscale.ai | 64 MB | AI upscaling (**requires a Vulkan GPU**, ~2 GB VRAM). |

## Registry (large families)

Larger models are hosted where the build sandbox cannot reach them (Hugging Face is blocked), so they are
installed on the user's machine and verified there:

- **whisper/small-ct2, whisper/medium-ct2, whisper/large-v3-turbo-ct2** — speech-to-text (faster-whisper).
- **piper/ar-kareem-medium, piper/en-lessac-medium** — higher-quality TTS than the always-available
  eSpeak NG voice.
- **llm/qwen2.5-3b-instruct-q4, llm/qwen2.5-7b-instruct-q4** — local text model for the assistant and the
  Creator script writer (the deterministic planner works with no model at all).
- **sd/sdxl-turbo** — local image generation (needs a capable GPU).
- **wan/2.1-t2v-1.3b** — local text-to-video generation (needs ≥ 8–12 GB VRAM). Without it, the Creator
  runs in honest **animatic** mode.

## Not yet implemented

These models install and checksum-verify, but their runtime **inference** is not implemented in this
build, so `verify:models` reports them as **skipped** (no test harness) and no feature consumes them yet:

- **mediapipe/selfie-segmenter** (`vision.segmentation`) — person/background segmentation.
- **mediapipe/face-landmarker** (`vision.faces`) — 478-point landmarks for finer masks.

They are listed honestly rather than presented as working features.

## Test samples

Per-model self-tests run on bundled fixtures in `resources/test/` (a face photo, a text image, a speech
sample). A model that cannot actually run on the current machine fails its test with the real reason
(for example a missing `libEGL.so.1`), and is never reported as passing.
