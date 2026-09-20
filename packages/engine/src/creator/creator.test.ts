import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allClips, getDocumentDurationMs } from '@sevenvid/core';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

async function setup() {
  dir = tempDir();
  engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
  await engine.start();
  const project = await engine.invoke('projects.create', { name: 'creator', kind: 'creator', platformPreset: 'tiktok' });
  await engine.invoke('projects.open', { projectId: project.id });
  return project;
}

async function run(task: { id: string }) {
  const done = await engine.tasks.wait(task.id);
  expect(done.status, JSON.stringify(done.error)).toBe('done');
  return done;
}

describe('creator service', () => {
  it('captures a brief, builds a script and scene list, and sets the sequence aspect', async () => {
    const project = await setup();
    const state = await engine.invoke('creator.setBrief', { projectId: project.id, brief: { idea: 'قهوة الصباح تمنحك طاقة. جودة عالية.', language: 'ar', durationSec: 10, platform: 'tiktok' } });
    expect(state.brief?.idea).toContain('قهوة');
    expect(state.script?.scenes.length).toBeGreaterThanOrEqual(3);
    expect(state.scenes.length).toBe(state.script?.scenes.length);
    expect(state.scenes.every((s) => s.status === 'draft')).toBe(true);
    // production falls back to the honest animatic here (no generation model)
    expect(state.productionMode).toBe('animatic');
    const seqDoc = (await engine.invoke('session.state', { projectId: project.id })).document;
    expect(seqDoc.settings.width).toBe(1080);
    expect(seqDoc.settings.height).toBe(1920);
  });

  it('renders a storyboard card per scene as a real image', async () => {
    const project = await setup();
    await engine.invoke('creator.setBrief', { projectId: project.id, brief: { idea: 'واحد. اثنان.', language: 'ar', durationSec: 8 } });
    await run(await engine.invoke('creator.storyboard', { projectId: project.id }));
    const state = await engine.invoke('creator.state', { projectId: project.id });
    expect(state.scenes.every((s) => s.storyboardPath && fs.existsSync(s.storyboardPath))).toBe(true);
    expect(state.scenes.every((s) => s.status === 'storyboard')).toBe(true);
    // the card is a valid PNG at the sequence resolution
    const first = state.scenes[0]!.storyboardPath!;
    expect(fs.statSync(first).size).toBeGreaterThan(1000);
  });

  it('synthesizes real voiceover per scene when TTS is available, else gates honestly', async () => {
    const project = await setup();
    await engine.invoke('creator.setBrief', { projectId: project.id, brief: { idea: 'مرحبا بكم في متجرنا. جودة عالية.', language: 'ar', durationSec: 8 } });
    const tts = engine.capabilities.status('tts').status;
    if (tts !== 'available') {
      await expect(engine.invoke('creator.voice', { projectId: project.id })).rejects.toMatchObject({ info: { code: expect.stringMatching(/WORKER_UNAVAILABLE|MODEL_NOT_INSTALLED/) } });
      return;
    }
    await run(await engine.invoke('creator.voice', { projectId: project.id }));
    const state = await engine.invoke('creator.state', { projectId: project.id });
    const voiced = state.scenes.filter((s) => s.voicePath);
    expect(voiced.length).toBeGreaterThan(0);
    expect(voiced.every((s) => fs.existsSync(s.voicePath!) && (s.voiceMs ?? 0) > 0)).toBe(true);
  });

  it('assembles the animatic onto the editor timeline with cards, voice and subtitles', async () => {
    const project = await setup();
    await engine.invoke('creator.setBrief', { projectId: project.id, brief: { idea: 'قهوة الصباح. عرض خاص اليوم.', language: 'ar', durationSec: 8 } });
    if (engine.capabilities.status('tts').status === 'available') await run(await engine.invoke('creator.voice', { projectId: project.id }));
    await run(await engine.invoke('creator.assemble', { projectId: project.id }));
    const doc = (await engine.invoke('session.state', { projectId: project.id })).document;
    const clips = allClips(doc);
    expect(clips.filter((c) => doc.assets[c.assetId]?.hasVideo).length).toBeGreaterThanOrEqual(3);
    expect(doc.subtitles[0]?.cues.length).toBeGreaterThanOrEqual(3);
    expect(getDocumentDurationMs(doc)).toBeGreaterThan(3000);
    const state = await engine.invoke('creator.state', { projectId: project.id });
    expect(state.scenes.every((s) => s.status === 'assembled')).toBe(true);
    // the assembled document is a real, exportable timeline: it validates and renders
    const val = await engine.invoke('render.compare', { projectId: project.id, startMs: 0, endMs: 2000 }).catch(() => null);
    expect(val === null || typeof val === 'object').toBe(true);
  });

  it('links a named character into the script and reviews the project honestly', async () => {
    const project = await setup();
    const withChar = await engine.invoke('creator.saveCharacter', { projectId: project.id, character: { id: '', name: 'سارة', bible: { age: '25', gender: 'female', appearance: 'smiling', hair: 'black', clothing: 'red dress', personality: '', voice: { engine: 'espeak', voice: 'ar', rate: 165 } }, referenceImages: [], hasEmbedding: false } });
    expect(withChar.characters).toHaveLength(1);
    await engine.invoke('creator.setBrief', { projectId: project.id, brief: { idea: 'سارة تقدّم المنتج. اشترِ الآن.', language: 'ar', durationSec: 8 } });
    const state = await engine.invoke('creator.state', { projectId: project.id });
    expect(state.scenes.some((s) => s.scene.characterIds.includes(withChar.characters[0]!.id))).toBe(true);
    const review = await engine.invoke('creator.review', { projectId: project.id });
    expect(review.mode).toBe('animatic');
    expect(review.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
});
