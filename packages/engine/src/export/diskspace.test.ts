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

describe('export disk-space estimate and precheck', () => {
  it('returns a coherent size + free-space estimate for a project', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'estimate', width: 1920, height: 1080, fps: 30 });
    await engine.invoke('projects.open', { projectId: project.id });
    const crf = await engine.invoke('export.estimate', { projectId: project.id, settings: { presetId: 'youtube-1080p', qualityMode: 'crf', crf: 18 } });
    expect(crf.estimatedBytes).toBeGreaterThan(0);
    expect(crf.videoBitrateKbps).toBeGreaterThan(0);
    expect(crf.requiredBytes).toBeGreaterThan(crf.estimatedBytes); // includes working headroom
    expect(crf.enoughSpace).toBe(true); // a temp dir has room for a near-empty timeline
    expect(typeof crf.targetDir).toBe('string');
  });

  it.skipIf(!hasFixtures)('refuses to start an export that would not fit on disk', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'nospace', width: 640, height: 360, fps: 30 });
    await engine.invoke('projects.open', { projectId: project.id });
    const imported = await engine.invoke('media.import', { paths: [source], projectId: project.id });
    const asset = imported.assets[0]!;
    const analyze = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === asset.id)!;
    await engine.tasks.wait(analyze.id);
    await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: asset.id });
    await engine.invoke('session.command', { projectId: project.id, command: { type: 'timeline.setDuration', targetMs: 2000, strategy: 'trim-end' } });
    // A petabyte-scale bitrate makes the estimate exceed any real disk, so the precheck must reject before rendering.
    const huge = { presetId: 'custom' as const, qualityMode: 'bitrate' as const, videoBitrateKbps: 10_000_000_000_000, audioBitrateKbps: 192 };
    const est = await engine.invoke('export.estimate', { projectId: project.id, settings: huge, outputPath: path.join(dir, 'out', 'huge.mp4') });
    expect(est.enoughSpace).toBe(false);
    await expect(engine.invoke('export.start', { projectId: project.id, settings: huge, outputPath: path.join(dir, 'out', 'huge.mp4') })).rejects.toMatchObject({ info: { code: 'DISK_FULL' } });
    // and nothing was written
    expect(fs.existsSync(path.join(dir, 'out', 'huge.mp4'))).toBe(false);
  });
});
