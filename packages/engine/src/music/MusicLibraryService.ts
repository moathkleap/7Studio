import fs from 'node:fs';
import path from 'node:path';
import { slugify, suggestClearedAlternative, type MusicQuery, type MusicTrack } from '@sevenstudios/core';
import type { Logger } from '../logging/logger';

/**
 * A local library of cleared (royalty-free / user-owned) music that MAY be embedded in an edit — the honest
 * alternative to a copyrighted trend sound. Tracks are described by a sidecar `.json` next to the audio file
 * ({ name, file, tags?, mood?, durationMs?, source? }); a track is only listed once its audio file is
 * verified to exist on disk, so a suggestion is never a track that cannot actually be used.
 */
export class MusicLibraryService {
  constructor(
    private readonly dirs: string[],
    private readonly logger: Logger,
  ) {}

  /** All cleared tracks found across the configured directories (bundled resources + the user's library). */
  list(): MusicTrack[] {
    const out: MusicTrack[] = [];
    const seen = new Set<string>();
    for (const dir of this.dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.json')) continue;
        const track = this.readSidecar(path.join(dir, entry));
        if (track && !seen.has(track.id)) {
          seen.add(track.id);
          out.push(track);
        }
      }
    }
    return out;
  }

  /** The best cleared alternative for a mood/tags query, or null when nothing in the library matches. */
  suggest(query: MusicQuery): MusicTrack | null {
    return suggestClearedAlternative(query, this.list());
  }

  private readSidecar(file: string): MusicTrack | null {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const rel = typeof raw.file === 'string' ? raw.file.trim() : '';
      if (!name || !rel) return null;
      const audioPath = path.isAbsolute(rel) ? rel : path.join(path.dirname(file), rel);
      if (!fs.existsSync(audioPath)) {
        this.logger.warn({ module: 'music', file, audioPath }, 'skipping music sidecar; audio file not found');
        return null;
      }
      return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `music-${slugify(name)}`,
        name,
        file: audioPath,
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
        mood: typeof raw.mood === 'string' && raw.mood.trim() ? raw.mood.trim() : null,
        durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
        licensed: true,
        source: typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : null,
      };
    } catch (err) {
      this.logger.warn({ module: 'music', file, err }, 'invalid music sidecar');
      return null;
    }
  }
}
