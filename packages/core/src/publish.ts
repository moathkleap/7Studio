import type { ContainerId } from './presets';

/** How a source frame is reframed onto a target canvas of a different aspect ratio. */
export type ReframeStrategy = 'crop' | 'fit' | 'blur-fill';

export type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'x' | 'linkedin';

export interface PublishTarget {
  id: string;
  platform: PublishPlatform;
  nameKey: string;
  /** Target canvas. */
  width: number;
  height: number;
  /** Frames-per-second cap (null = keep the sequence's fps). */
  maxFps: number | null;
  /** Hard duration limit in ms (null = none). */
  maxDurationMs: number | null;
  container: ContainerId;
  aspectLabel: string;
  /** Recommended caption length and hashtag count (guidance shown in the UI). */
  captionMax: number;
  hashtagMax: number;
  defaultStrategy: ReframeStrategy;
}

const t = (
  id: string,
  platform: PublishPlatform,
  nameKey: string,
  width: number,
  height: number,
  opts: Partial<Omit<PublishTarget, 'id' | 'platform' | 'nameKey' | 'width' | 'height'>> = {},
): PublishTarget => ({
  id,
  platform,
  nameKey,
  width,
  height,
  maxFps: opts.maxFps ?? 60,
  maxDurationMs: opts.maxDurationMs ?? null,
  container: opts.container ?? 'mp4',
  aspectLabel: opts.aspectLabel ?? `${Math.round((width / height) * 100) / 100}`,
  captionMax: opts.captionMax ?? 2200,
  hashtagMax: opts.hashtagMax ?? 30,
  // 'crop' fills the whole canvas (default for cross-aspect targets); 16:9 targets override to 'fit'.
  defaultStrategy: opts.defaultStrategy ?? 'crop',
});

/** Built-in publish targets (platform + format variant), with each platform's canvas, limits and defaults. */
export const PUBLISH_TARGETS: PublishTarget[] = [
  t('youtube-video', 'youtube', 'publish.target.youtubeVideo', 1920, 1080, { aspectLabel: '16:9', captionMax: 5000, hashtagMax: 15, defaultStrategy: 'fit' }),
  t('youtube-shorts', 'youtube', 'publish.target.youtubeShorts', 1080, 1920, { aspectLabel: '9:16', maxDurationMs: 60_000, captionMax: 100, hashtagMax: 15 }),
  t('tiktok', 'tiktok', 'publish.target.tiktok', 1080, 1920, { aspectLabel: '9:16', maxDurationMs: 600_000, captionMax: 2200, hashtagMax: 30 }),
  t('instagram-reels', 'instagram', 'publish.target.instagramReels', 1080, 1920, { aspectLabel: '9:16', maxDurationMs: 90_000, captionMax: 2200, hashtagMax: 30 }),
  t('instagram-post', 'instagram', 'publish.target.instagramPost', 1080, 1350, { aspectLabel: '4:5', maxDurationMs: 60_000, captionMax: 2200, hashtagMax: 30 }),
  t('instagram-story', 'instagram', 'publish.target.instagramStory', 1080, 1920, { aspectLabel: '9:16', maxDurationMs: 60_000, captionMax: 2200, hashtagMax: 10 }),
  t('facebook-feed', 'facebook', 'publish.target.facebookFeed', 1080, 1080, { aspectLabel: '1:1', captionMax: 5000, hashtagMax: 30 }),
  t('x-post', 'x', 'publish.target.xPost', 1280, 720, { aspectLabel: '16:9', maxDurationMs: 140_000, captionMax: 280, hashtagMax: 10, defaultStrategy: 'fit' }),
  t('linkedin', 'linkedin', 'publish.target.linkedin', 1920, 1080, { aspectLabel: '16:9', maxDurationMs: 600_000, captionMax: 3000, hashtagMax: 10, defaultStrategy: 'fit' }),
];

export function getPublishTarget(id: string): PublishTarget | undefined {
  return PUBLISH_TARGETS.find((x) => x.id === id);
}

/**
 * A trending sound suggested for a template or attached to a publish package.
 *
 * The audio itself is never embedded into an exported package: a copyrighted platform sound
 * (`licensed: false`) is added from within TikTok/Instagram at upload time, and only cleared
 * audio (`licensed: true` — royalty-free, user-owned or locally generated) may be added to the
 * edit. The suggestion is advisory metadata that keeps exports honest and rights-clean.
 */
export interface TrendSound {
  name: string;
  /** Link to the sound on its platform, so it can be found and applied at upload time (null if unknown). */
  url: string | null;
  /** True when the sound is cleared to embed (royalty-free / user-owned / locally generated). */
  licensed: boolean;
  /** Where the sound comes from, e.g. 'tiktok', 'instagram', 'local' (null if unknown). */
  source: string | null;
}

/** Whether a suggested sound may be embedded in an export, or must be added from within the platform. */
export function canEmbedSound(sound: TrendSound): boolean {
  return sound.licensed;
}

/** A short, honest note on how a suggested sound may be used, shown in the UI and written into a package. */
export function describeSoundUsage(sound: TrendSound): string {
  return sound.licensed
    ? `"${sound.name}" is cleared to use and may be added to the edit.`
    : `"${sound.name}" is a copyrighted platform sound and is not embedded; add it from within the app when you upload.`;
}

/** Normalizes unknown JSON (a template field or an IPC payload) into a TrendSound, or null when it has no name. */
export function parseTrendSound(input: unknown): TrendSound | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return null;
  return {
    name,
    url: typeof o.url === 'string' && o.url.trim() ? o.url.trim() : null,
    licensed: o.licensed === true,
    source: typeof o.source === 'string' && o.source.trim() ? o.source.trim() : null,
  };
}

export interface PublishFit {
  targetId: string;
  sourceAspect: number;
  targetAspect: number;
  /** True when source and target aspect ratios differ enough to need reframing. */
  needsReframe: boolean;
  /** True when the source is smaller than the target canvas (will be upscaled). */
  upscales: boolean;
  /** ms over the platform limit (0 when within it). */
  overByMs: number;
  /** True when the export will be trimmed to fit the platform's duration limit. */
  willTrim: boolean;
}

/** Describes how a source composition fits a target, so the UI can warn before building. */
export function planPublishFit(source: { width: number; height: number; durationMs: number }, target: PublishTarget): PublishFit {
  const sourceAspect = source.width / source.height;
  const targetAspect = target.width / target.height;
  const overByMs = target.maxDurationMs != null ? Math.max(0, source.durationMs - target.maxDurationMs) : 0;
  return {
    targetId: target.id,
    sourceAspect,
    targetAspect,
    needsReframe: Math.abs(sourceAspect - targetAspect) > 0.01,
    upscales: source.width < target.width || source.height < target.height,
    overByMs,
    willTrim: overByMs > 0,
  };
}

/** Normalizes hashtags: strips '#', splits on spaces/commas, dedupes, caps to the platform limit. */
export function normalizeHashtags(input: string, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const tag = raw.replace(/^#+/, '').trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** The caption text written into a package, with hashtags appended on their own line. */
export function composeCaption(caption: string, hashtags: string[]): string {
  const body = caption.trim();
  const tags = hashtags.map((h) => `#${h}`).join(' ');
  return [body, tags].filter(Boolean).join('\n\n');
}
