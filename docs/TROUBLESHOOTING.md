# Troubleshooting

Every error in Seven Studios has a stable code, a translated message and recovery hints. The **Diagnostics** screen
shows live logs, errors, the task history and the network log, and can export a single **diagnostics
bundle** (zip) with system info, settings, capabilities, tasks, errors and rotated logs — attach it when
reporting an issue.

## FFmpeg not found (`FFMPEG_NOT_FOUND`)

Seven Studios needs FFmpeg and FFprobe (≥ 6.0, with `libx264/libx265/libsvtav1/libaom/libvpx/libass`). It looks in:

1. `SEVENSTUDIOS_FFMPEG_PATH` (a directory or a binary path),
2. bundled `resources/bin/<platform>-<arch>/`,
3. the system `PATH`.

Install FFmpeg (`sudo apt-get install ffmpeg`, `brew install ffmpeg`, or a static build) or set
`SEVENSTUDIOS_FFMPEG_PATH`.

## MediaPipe fails to load (`libEGL.so.1` / `libGLESv2.so.2`)

On Linux, MediaPipe object detection needs OpenGL ES libraries even without a GPU:

```bash
sudo apt-get install libegl1 libgles2
```

`pnpm verify:models` will show the affected models as FAIL with the exact missing library until these are
installed.

## A model download is blocked or fails

Downloads require external processing to be enabled (**Settings → Privacy**) and go through the network
gateway. If a host is unreachable (some model hosts are blocked on locked-down networks), the app reports
it honestly and the capability stays `needs-model`. Re-runs resume partial downloads; sha256 mismatches
are rejected and the file is re-fetched.

## Python runtime not available (`needs-runtime`)

Vision, speech and generation models need the Python worker. In development, create
`ai-worker/.venv` (see `docs/INSTALL.md`); in a packaged build use **AI Models → Set up runtime**. Until
then, everything that relies only on FFmpeg/Node (editing, export, OCR, the deterministic assistant) still
works.

## Not enough disk space (`DISK_FULL`)

The export center estimates the output size and refuses to start if it will not fit, showing how much is
needed vs. free. If a render runs out of space mid-way, it stops with a disk-full error and removes the
partial file. Free space (delete caches under the project `data_dir/cache`, old exports) and retry.

## The app didn't shut down cleanly

On the next launch, Seven Studios restores the last valid project snapshot plus the `journal.ndjson` patches and
offers recovery. Tasks that were `running` are marked `interrupted` with a retry option — nothing is
reported as completed that did not finish.

## A provider connection fails

In **Settings → External Providers**, use **Test** — it does a real round-trip and reports the actual
error (bad key, wrong base URL, host unreachable, or blocked because external processing is disabled). API
keys are stored with the OS keychain when available and never shown back in the interface.

## Nothing plays in the preview

Some containers/codecs (HEVC, ProRes, MKV, AVI) are not directly decodable in the preview; Seven Studios generates
a proxy for them in the background. Wait for the proxy task to finish (Diagnostics → Tasks), or check the
source imported correctly in the Media library.
