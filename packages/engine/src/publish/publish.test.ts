import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const source = path.join(fixtures, 'clip-10s-720p.mp4');
const hasFixtures = fs.existsSync(source);

let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

describe.skipIf(!hasFixtures)('publish packaging', () => {
  it('reframes a project to platform canvases and writes validated packages', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'publish', width: 1280, height: 720, fps: 30 });
    await engine.invoke('projects.open', { projectId: project.id });
    const imported = await engine.invoke('media.import', { paths: [source], projectId: project.id });
    const asset = imported.assets[0]!;
    const analyze = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === asset.id)!;
    expect((await engine.tasks.wait(analyze.id)).status).toBe('done');
    await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: asset.id });
    await engine.invoke('session.command', { projectId: project.id, command: { type: 'timeline.setDuration', targetMs: 3000, strategy: 'trim-end' } });

    // targets carry a fit plan for the project (16:9 source -> vertical needs reframing)
    const targets = await engine.invoke('publish.targets', { projectId: project.id });
    expect(targets.length).toBeGreaterThanOrEqual(6);
    const tiktokTarget = targets.find((t) => t.id === 'tiktok')!;
    expect(tiktokTarget.fit?.needsReframe).toBe(true);
    expect(targets.find((t) => t.id === 'youtube-video')!.fit?.needsReframe).toBe(false);

    // build a vertical (crop) package and a 16:9 (fit) package
    const sound = { name: 'Trending sound', url: 'https://www.tiktok.com/music', licensed: false, source: 'tiktok' };
    for (const [targetId, w, h] of [['tiktok', 1080, 1920], ['youtube-video', 1920, 1080]] as const) {
      const started = await engine.invoke('publish.build', { projectId: project.id, targetId, caption: 'Hello world', hashtags: '#Travel travel #sunset', sound });
      expect(['queued', 'running']).toContain(started.status);
      const done = await engine.tasks.wait(started.taskId!);
      expect(done.status, `${targetId}: ${JSON.stringify(done.error)}`).toBe('done');
      const pkg = (await engine.invoke('publish.get', { id: started.id }))!;
      expect(pkg.status, targetId).toBe('done');
      expect(pkg.width).toBe(w);
      expect(pkg.height).toBe(h);
      const v = pkg.validation as { ok: boolean; width: number; height: number };
      expect(v.ok, targetId).toBe(true);
      expect(v.width).toBe(w);
      expect(v.height).toBe(h);
      // files written: video, thumbnail, caption, metadata
      expect(fs.statSync(pkg.videoPath).size).toBeGreaterThan(1000);
      expect(pkg.thumbnailPath && fs.existsSync(pkg.thumbnailPath)).toBeTruthy();
      const caption = fs.readFileSync(pkg.captionPath!, 'utf8');
      expect(caption).toContain('Hello world');
      expect(caption).toContain('#Travel'); // hashtags normalized & deduped (travel/#Travel -> one)
      const meta = JSON.parse(fs.readFileSync(path.join(pkg.dir, 'metadata.json'), 'utf8'));
      expect(meta.target).toBe(targetId);
      expect(meta.hashtags).toContain('Travel');
      // a suggested (copyrighted) sound is carried as advisory metadata, never embedded
      expect(pkg.suggestedSound?.name).toBe('Trending sound');
      expect(meta.suggestedSound.licensed).toBe(false);
      expect(meta.embeddedSound).toBe(false); // copyrighted sound is never embedded
      expect(pkg.warnings.some((w) => w.includes('not embedded'))).toBe(true);
      const soundNote = fs.readFileSync(path.join(pkg.dir, 'sound.txt'), 'utf8');
      expect(soundNote).toContain('add it from within the app');
    }

    const recent = await engine.invoke('publish.recent', {});
    expect(recent.length).toBe(2);
  }, 240_000);

  it('refuses to publish an empty timeline', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'empty' });
    await expect(engine.invoke('publish.build', { projectId: project.id, targetId: 'tiktok' })).rejects.toMatchObject({ info: { code: 'VALIDATION_FAILED' } });
  });
});
