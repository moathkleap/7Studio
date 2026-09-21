import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testEngine, tempDir, cleanup } from '../test/helpers';
import type { Engine } from '../api/createEngine';

let dir: string;
let engine: Engine;

afterEach(() => {
  engine?.dispose();
  cleanup(dir);
});

describe('MusicLibraryService', () => {
  it('lists cleared tracks whose audio exists and suggests by mood/tags', async () => {
    dir = tempDir();
    const musicDir = path.join(dir, 'music');
    fs.mkdirSync(musicDir, { recursive: true });
    // A valid track: audio file present.
    fs.writeFileSync(path.join(musicDir, 'calm.mp3'), 'ID3');
    fs.writeFileSync(path.join(musicDir, 'calm.json'), JSON.stringify({ name: 'Calm Piano', file: 'calm.mp3', mood: 'calm', tags: ['piano', 'soft'], source: 'local' }));
    // A sidecar pointing at a missing file: must be skipped (never suggest something unusable).
    fs.writeFileSync(path.join(musicDir, 'ghost.json'), JSON.stringify({ name: 'Ghost', file: 'ghost.mp3' }));

    engine = testEngine(dir);
    const list = await engine.invoke('music.list');
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ name: 'Calm Piano', mood: 'calm', licensed: true });
    expect(path.isAbsolute(list[0]!.file)).toBe(true);

    const suggested = await engine.invoke('music.suggest', { mood: 'calm', tags: ['piano'] });
    expect(suggested?.name).toBe('Calm Piano');

    const none = await engine.invoke('music.suggest', { mood: 'dramatic', tags: ['orchestral'] });
    expect(none).toBeNull();
  });
});
