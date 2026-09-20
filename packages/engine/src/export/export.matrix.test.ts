import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioCodecId, ContainerId, VideoCodecId } from '@sevenvid/core';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const source = path.join(fixtures, 'clip-10s-720p.mp4');
const hasFixtures = fs.existsSync(source);

/** The software encoder each codec resolves to in this FFmpeg build; the combo is skipped honestly when none exist. */
const SW_FOR: Record<VideoCodecId, string[]> = {
  h264: ['libx264'],
  h265: ['libx265'],
  av1: ['libsvtav1', 'libaom-av1'],
  vp9: ['libvpx-vp9'],
};
/** Container video codec is verified against ffprobe's reported codec name. */
const PROBE_NAME: Record<VideoCodecId, string> = { h264: 'h264', h265: 'hevc', av1: 'av1', vp9: 'vp9' };

interface Combo {
  container: ContainerId;
  videoCodec: VideoCodecId;
  audioCodec: AudioCodecId;
  width: number;
  height: number;
}

// Container × codec × resolution. Small resolutions keep every combo fast; mp4/h264 covers two resolutions.
const MATRIX: Combo[] = [
  { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 320, height: 180 },
  { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 480, height: 270 },
  { container: 'mp4', videoCodec: 'h265', audioCodec: 'aac', width: 320, height: 180 },
  { container: 'mp4', videoCodec: 'av1', audioCodec: 'aac', width: 320, height: 180 },
  { container: 'mov', videoCodec: 'h264', audioCodec: 'aac', width: 320, height: 180 },
  { container: 'mov', videoCodec: 'h265', audioCodec: 'aac', width: 320, height: 180 },
  { container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', width: 320, height: 180 },
  { container: 'webm', videoCodec: 'av1', audioCodec: 'opus', width: 320, height: 180 },
];

let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

describe.skipIf(!hasFixtures)('export matrix (container × codec × resolution)', () => {
  it('renders and validates every supported combination', async () => {
    dir = tempDir();
    engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
    await engine.start();
    const project = await engine.invoke('projects.create', { name: 'matrix', width: 640, height: 360, fps: 30 });
    await engine.invoke('projects.open', { projectId: project.id });
    const imported = await engine.invoke('media.import', { paths: [source], projectId: project.id });
    const asset = imported.assets[0]!;
    const analyze = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === asset.id)!;
    expect((await engine.tasks.wait(analyze.id)).status).toBe('done');
    await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: asset.id });
    // Trim to ~2s so each of the eight encodes is quick, while keeping both a video and an audio stream.
    await engine.invoke('session.command', { projectId: project.id, command: { type: 'timeline.setDuration', targetMs: 2000, strategy: 'trim-end' } });

    const available = engine.ffmpeg.encoders;
    let ran = 0;
    const skipped: string[] = [];
    for (const c of MATRIX) {
      const label = `${c.container}/${c.videoCodec}/${c.audioCodec}/${c.width}x${c.height}`;
      if (!SW_FOR[c.videoCodec].some((e) => available.includes(e))) {
        skipped.push(label);
        continue;
      }
      const out = path.join(dir, 'out', `${label.replace(/[/]/g, '_')}.${c.container}`);
      const started = await engine.invoke('export.start', {
        projectId: project.id,
        settings: { presetId: 'custom', container: c.container, videoCodec: c.videoCodec, audioCodec: c.audioCodec, width: c.width, height: c.height, qualityMode: 'crf', crf: 30, speedPreset: 'ultrafast', hardwareAcceleration: 'off', burnSubtitles: false },
        outputPath: out,
      });
      const done = await engine.tasks.wait(started.taskId!);
      expect(done.status, `${label}: ${JSON.stringify(done.error)}`).toBe('done');
      const info = (await engine.invoke('export.get', { exportId: started.id }))!;
      expect(info.status, label).toBe('done');
      const validation = info.validation as { ok: boolean; width: number; height: number; videoCodec: string; audioCodec: string; checks: Array<{ name: string; ok: boolean; detail: string }> };
      expect(validation.ok, `${label}: ${JSON.stringify(validation.checks?.filter((k) => !k.ok))}`).toBe(true);
      expect(validation.width, label).toBe(c.width);
      expect(validation.height, label).toBe(c.height);
      expect(validation.videoCodec, label).toBe(PROBE_NAME[c.videoCodec]);
      // decode check must have run and passed (proves the file is genuinely playable, not just present)
      expect(validation.checks.find((k) => k.name === 'decode')?.ok, `${label} decode`).toBe(true);
      expect(fs.statSync(out).size).toBeGreaterThan(1000);
      ran++;
    }
    // In this environment every encoder is present, so nothing should be skipped; assert the matrix actually ran.
    expect(ran, `skipped: ${skipped.join(', ')}`).toBeGreaterThanOrEqual(MATRIX.length - skipped.length);
    expect(ran).toBeGreaterThanOrEqual(4);
  }, 240_000);
});
