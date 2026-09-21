# Bundled binaries

Place static **FFmpeg** and **FFprobe** binaries here, under a per-platform folder, to ship them with
the packaged app:

```
resources/bin/
  linux-x64/ffmpeg    linux-x64/ffprobe
  win32-x64/ffmpeg.exe win32-x64/ffprobe.exe
  darwin-arm64/ffmpeg  darwin-arm64/ffprobe
  darwin-x64/ffmpeg    darwin-x64/ffprobe
```

The engine's FFmpeg locator resolves binaries in this order:

1. `SEVENSTUDIOS_FFMPEG_PATH` (an explicit directory or binary path),
2. `resources/bin/<platform>-<arch>/` (bundled, as above),
3. the system `PATH`.

Binaries are intentionally **not** committed to the repository. Download builds that include
`libx264/libx265/libsvtav1/libaom/libvpx/libass` for each target platform (for example from a
trusted static-FFmpeg distribution) and drop them here before running `electron-builder`.
