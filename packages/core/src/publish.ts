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
