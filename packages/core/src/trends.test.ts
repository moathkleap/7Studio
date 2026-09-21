import { describe, expect, it } from 'vitest';
import { slugify, suggestClearedAlternative, trackToSound, trendItemToTemplate, type MusicTrack } from './trends';

describe('slugify', () => {
  it('lowercases, replaces non-alphanumerics with dashes and trims', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
    expect(slugify('TikTok #Transition 2024')).toBe('tiktok-transition-2024');
    expect(slugify('---')).toBe('');
  });
});

describe('trendItemToTemplate', () => {
  it('normalizes a feed item into a stable trend template', () => {
    const tpl = trendItemToTemplate(
      {
        id: 'transition-1',
        name: 'Beat Drop Transition',
        hook: 'Wait for it',
        hashtags: ['fyp', 'transition', 42],
        settings: { width: 1080, height: 1920, fps: 30, aspectPreset: '9:16' },
        suggestedSound: { name: 'Trending beat', url: 'https://tiktok.com/music/x', licensed: false, source: 'tiktok' },
      },
      'feed.example.com',
    )!;
    expect(tpl.id).toBe('tpl-trend-feed-example-com-transition-1');
    expect(tpl.category).toBe('trend');
    expect(tpl.name).toBe('Beat Drop Transition');
    expect(tpl.hook).toBe('Wait for it');
    expect(tpl.hashtags).toEqual(['fyp', 'transition']); // non-strings dropped
    expect(tpl.trendSource).toBe('feed.example.com');
    expect(tpl.suggestedSound).toEqual({ name: 'Trending beat', url: 'https://tiktok.com/music/x', licensed: false, source: 'tiktok' });
  });

  it('falls back to a vertical canvas and derives the id from the name when no id is given', () => {
    const tpl = trendItemToTemplate({ title: 'My Trend' }, 'host')!;
    expect(tpl.id).toBe('tpl-trend-host-my-trend');
    expect(tpl.name).toBe('My Trend');
    expect(tpl.settings).toEqual({ width: 1080, height: 1920, fps: 30, aspectPreset: '9:16' });
    expect(tpl.suggestedSound).toBeNull();
  });

  it('returns null when the item has no usable name', () => {
    expect(trendItemToTemplate({ hook: 'x' }, 'host')).toBeNull();
    expect(trendItemToTemplate(null as never, 'host')).toBeNull();
  });
});

describe('suggestClearedAlternative', () => {
  const catalog: MusicTrack[] = [
    { id: 'a', name: 'Calm Piano', file: '/m/a.mp3', tags: ['calm', 'piano'], mood: 'calm', durationMs: null, licensed: true, source: 'local' },
    { id: 'b', name: 'Energetic Pop', file: '/m/b.mp3', tags: ['upbeat', 'pop', 'energetic'], mood: 'energetic', durationMs: null, licensed: true, source: 'local' },
  ];

  it('scores mood (+2) and shared tags (+1) and returns the best match', () => {
    expect(suggestClearedAlternative({ mood: 'energetic', tags: ['pop'] }, catalog)?.id).toBe('b');
    expect(suggestClearedAlternative({ tags: ['piano'] }, catalog)?.id).toBe('a');
  });

  it('returns null when nothing matches or the catalog is empty', () => {
    expect(suggestClearedAlternative({ mood: 'dramatic', tags: ['orchestral'] }, catalog)).toBeNull();
    expect(suggestClearedAlternative({ tags: ['pop'] }, [])).toBeNull();
    expect(suggestClearedAlternative({}, catalog)).toBeNull();
  });
});

describe('trackToSound', () => {
  it('converts a cleared track into an embeddable sound', () => {
    const track: MusicTrack = { id: 'a', name: 'Calm Piano', file: '/m/a.mp3', tags: [], mood: null, durationMs: null, licensed: true, source: null };
    expect(trackToSound(track)).toEqual({ name: 'Calm Piano', url: '/m/a.mp3', licensed: true, source: 'local' });
  });
});
