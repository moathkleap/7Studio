import { afterEach, describe, expect, it } from 'vitest';
import { testEngine, tempDir, cleanup } from '../test/helpers';
import type { Engine } from '../api/createEngine';

let dir: string;
let engine: Engine;

afterEach(() => {
  engine?.dispose();
  cleanup(dir);
});

describe('TrendsService.ingest', () => {
  it('upserts feed items as trend templates and updates on re-sync instead of duplicating', () => {
    dir = tempDir();
    engine = testEngine(dir);
    const items = [
      { id: 't1', name: 'Transition Trend', hook: 'Wait for it', hashtags: ['fyp'], suggestedSound: { name: 'Beat', url: 'https://tiktok.com/m/1', licensed: false, source: 'tiktok' } },
      { id: 't2', name: 'Reveal Trend' },
      { hook: 'no name' }, // skipped
    ];
    const first = engine.trends.ingest(items, 'feed.example.com');
    expect(first).toMatchObject({ added: 2, updated: 0, skipped: 1, total: 3, sourceHost: 'feed.example.com' });

    const templates = engine.templates.list().filter((t) => t.category === 'trend');
    expect(templates.length).toBe(2);
    const transition = templates.find((t) => t.name === 'Transition Trend')!;
    expect(transition.builtin).toBe(false);
    expect(transition.hook).toBe('Wait for it');
    expect(transition.suggestedSound).toEqual({ name: 'Beat', url: 'https://tiktok.com/m/1', licensed: false, source: 'tiktok' });
    expect(transition.trendSource).toBe('feed.example.com');

    // Re-ingesting the same ids updates them; a stable id means no duplicates.
    const second = engine.trends.ingest([{ id: 't1', name: 'Transition Trend v2' }], 'feed.example.com');
    expect(second).toMatchObject({ added: 0, updated: 1 });
    expect(engine.templates.list().filter((t) => t.category === 'trend').length).toBe(2);
    expect(engine.templates.list().find((t) => t.id.endsWith('-t1'))!.name).toBe('Transition Trend v2');
  });

  it('sync is blocked when trend sync is disabled in Privacy settings', async () => {
    dir = tempDir();
    engine = testEngine(dir);
    // allowTrends defaults to false.
    await expect(engine.trends.sync('https://feed.example.com/trends.json')).rejects.toMatchObject({ info: { code: 'NETWORK_BLOCKED' } });
  });
});
