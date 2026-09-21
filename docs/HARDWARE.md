# Hardware

7vid detects your hardware (CPU, RAM, disk, and GPU/VRAM where available) and gates heavy features on it,
with a clear reason and the recommended spec when something cannot run. The live snapshot is on the
**System** screen and in the status bar.

## Minimum vs. recommended

| | Minimum | Recommended |
|---|---|---|
| CPU | 4 cores | 8+ cores (faster export and analysis) |
| RAM | 8 GB | 16 GB+ |
| Disk | 5 GB free + space for media and exports | SSD with generous headroom |
| GPU | none (software encode, CPU inference) | discrete GPU for hardware encode, upscaling and generation |

Editing, export, OCR, audio tools, face/object detection and the deterministic assistant all run on CPU.
A GPU only matters for the GPU-only features below.

## What needs a GPU

| Feature | Requirement |
|---|---|
| Hardware video encoding | NVENC / QSV / AMF / VideoToolbox / VAAPI — **verified by a real one-second test encode** before use, with automatic software fallback. |
| AI upscaling (Real-ESRGAN) | Vulkan-capable GPU, ~2 GB VRAM. Without it, Lanczos (non-AI) upscaling is used and labelled as such. |
| Local image generation (SDXL-Turbo) | A capable GPU; otherwise shown as `needs-hardware`. |
| Local video generation (Wan 2.1) | ≥ 8–12 GB VRAM; otherwise the Creator runs in honest **animatic** mode. |

## Video encoders

The export center probes the FFmpeg build for encoders and then **test-encodes one second** with each
hardware encoder to confirm it actually works on this machine before offering it. If a hardware encoder
fails at render time, the export automatically retries with the software encoder and records a warning —
it never fails silently.

## Disk space

Before an export starts, 7vid estimates the output size (from the bitrate, or from resolution/fps/CRF/
codec in CRF mode) plus working headroom and compares it with the free space on the target volume. If it
will not fit, the export is refused up front with the numbers. An out-of-space failure mid-render is
reported as a disk-full error and the partial file is removed.

## Linux: MediaPipe

MediaPipe (object detection, and the not-yet-wired segmentation/landmark models) needs OpenGL ES
libraries even on CPU-only machines:

```bash
sudo apt-get install libegl1 libgles2
```

Without them the models fail to load with `libEGL.so.1` / `libGLESv2.so.2` errors (see
`docs/TROUBLESHOOTING.md`).

## Pausing heavy work

Long tasks (export, analysis) support pause/resume and cancel. On POSIX, pause uses `SIGSTOP`/`SIGCONT`
on the FFmpeg process; where a task type cannot be paused, the app says so honestly rather than pretending.
