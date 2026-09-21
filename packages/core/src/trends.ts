import { parseTrendSound, type TrendSound } from './publish';

/** A raw item from a trends feed, before normalization (fields are untrusted and loosely typed). */
export type TrendFeedItem = Record<string, unknown>;

/** A cleared (royalty-free / user-owned / locally generated) music track that MAY be embedded in an edit. */
export interface MusicTrack {
  id: string;
  name: string;
  /** Absolute path to the audio file on disk. */
  file: string;
  tags: string[];
  mood: string | null;
  durationMs: number | null;
  /** Always true for a library track — the library only holds cleared audio. */
  licensed: true;
  source: string | null;
}

/** Turns arbitrary text into a stable, filesystem/id-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
}

/**
 * Normalizes one trends-feed item into a template JSON object ready to upsert as a `category: "trend"`
 * template, or null when it has no usable name. The id is stable (derived from the item id or name) so a
 * re-sync updates the same template rather than duplicating it. A copyrighted suggested sound is preserved
 * as advisory metadata; it is never embedded (see PublishService / TrendSound).
 */
export function trendItemToTemplate(item: TrendFeedItem, sourceHost: string): Record<string, unknown> | null {
  if (!item || typeof item !== 'object') return null;
  const name = str(item.name) ?? str(item.title);
  if (!name) return null;
  const rawId = str(item.id) ?? name;
  const id = `tpl-trend-${slugify(sourceHost)}-${slugify(rawId)}`;
  const s = (item.settings ?? null) as Record<string, unknown> | null;
  const settings =
    s && typeof s.width === 'number' && typeof s.height === 'number'
      ? { width: s.width, height: s.height, fps: typeof s.fps === 'number' ? s.fps : 30, aspectPreset: str(s.aspectPreset) ?? 'custom' }
      : { width: 1080, height: 1920, fps: 30, aspectPreset: '9:16' };
  const sound = parseTrendSound(item.suggestedSound ?? item.sound);
  return {
    id,
    name,
    nameAr: str(item.nameAr),
    category: 'trend',
    description: str(item.description),
    descriptionAr: str(item.descriptionAr),
    platformPreset: str(item.platformPreset),
    settings,
    subtitleStyle: (item.subtitleStyle as Record<string, unknown> | undefined) ?? null,
    exportPresetId: str(item.exportPresetId),
    targetDurationMs: typeof item.targetDurationMs === 'number' ? item.targetDurationMs : null,
    hook: str(item.hook),
    hashtags: stringArray(item.hashtags),
    trendSource: sourceHost,
    suggestedSound: sound,
  };
}

/** A query for a cleared alternative, usually derived from a trend's copyrighted suggested sound. */
export interface MusicQuery {
  mood?: string | null;
  tags?: string[];
}

/**
 * Picks the best cleared alternative from a catalog for a given mood/tags, or null when nothing matches.
 * Scoring: +2 for a matching mood, +1 per shared tag. A zero score returns null — an honest "no cleared
 * alternative", never a random track — so a copyrighted trend sound is only ever replaced by a real match.
 */
export function suggestClearedAlternative(query: MusicQuery, catalog: MusicTrack[]): MusicTrack | null {
  const mood = query.mood?.trim().toLowerCase() || null;
  const tags = new Set((query.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));
  let best: MusicTrack | null = null;
  let bestScore = 0;
  for (const track of catalog) {
    let score = 0;
    if (mood && track.mood && track.mood.trim().toLowerCase() === mood) score += 2;
    for (const tag of track.tags) if (tags.has(tag.trim().toLowerCase())) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Converts a cleared library track into an embeddable TrendSound (licensed: true). */
export function trackToSound(track: MusicTrack): TrendSound {
  return { name: track.name, url: track.file, licensed: true, source: track.source ?? 'local' };
}
