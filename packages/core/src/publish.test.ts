import { describe, expect, it } from 'vitest';
import { PUBLISH_TARGETS, composeCaption, getPublishTarget, normalizeHashtags, planPublishFit } from './publish';

describe('publish targets', () => {
  it('exposes distinct targets for the major platforms with sane canvases', () => {
    const ids = PUBLISH_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PUBLISH_TARGETS) {
      expect(t.width).toBeGreaterThan(0);
      expect(t.height).toBeGreaterThan(0);
      expect(t.captionMax).toBeGreaterThan(0);
    }
    expect(getPublishTarget('tiktok')?.height).toBe(1920); // vertical
    expect(getPublishTarget('youtube-video')?.width).toBe(1920); // horizontal
    expect(getPublishTarget('nope')).toBeUndefined();
  });

  it('flags reframing, upscaling and over-length for a 1080p 2-minute source', () => {
    const src = { width: 1920, height: 1080, durationMs: 120_000 };
    const tiktok = planPublishFit(src, getPublishTarget('tiktok')!);
    expect(tiktok.needsReframe).toBe(true); // 16:9 -> 9:16
    expect(tiktok.willTrim).toBe(false); // under 10 min
    const shorts = planPublishFit(src, getPublishTarget('youtube-shorts')!);
    expect(shorts.willTrim).toBe(true); // 120s > 60s cap
    expect(shorts.overByMs).toBe(60_000);
    const yt = planPublishFit(src, getPublishTarget('youtube-video')!);
    expect(yt.needsReframe).toBe(false); // 16:9 -> 16:9
    expect(yt.upscales).toBe(false);
  });

  it('normalizes hashtags: strips #, dedupes, caps to the limit', () => {
    // dedupe is case-insensitive but keeps the first occurrence's original casing
    expect(normalizeHashtags('#Travel travel, #Sunset  #sunset #beach', 30)).toEqual(['Travel', 'Sunset', 'beach']);
    expect(normalizeHashtags('a b c d e', 3)).toEqual(['a', 'b', 'c']);
  });

  it('composes a caption with hashtags on their own line', () => {
    expect(composeCaption('Hello world', ['a', 'b'])).toBe('Hello world\n\n#a #b');
    expect(composeCaption('Only text', [])).toBe('Only text');
    expect(composeCaption('', ['a'])).toBe('#a');
  });
});
