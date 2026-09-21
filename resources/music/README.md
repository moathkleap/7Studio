# Cleared music library

This folder holds **cleared** (royalty-free or user-owned) music that MAY be embedded in an edit — the
honest alternative to a copyrighted trend sound, which is never downloaded or embedded (it is added from
within the platform at upload time).

The application also scans `<userData>/music` for the user's own cleared tracks.

## Sidecar format

Each track is described by a `.json` file placed next to its audio file. A track is only offered once its
audio file is verified to exist on disk, so a suggestion is never something that cannot actually be used.

```json
{
  "id": "upbeat-sunrise",
  "name": "Upbeat Sunrise",
  "file": "upbeat-sunrise.mp3",
  "tags": ["upbeat", "energetic", "vlog"],
  "mood": "energetic",
  "durationMs": 30000,
  "source": "local"
}
```

- `name` and `file` are required; `file` is relative to this folder (or an absolute path).
- `tags` and `mood` drive matching when suggesting an alternative for a trend's suggested sound.
- All tracks here are treated as cleared to embed (`licensed: true`).

No audio files are bundled in the repository; add your own cleared tracks here or under `<userData>/music`.
