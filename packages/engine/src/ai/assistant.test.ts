import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allClips, getDocumentDurationMs } from '@sevenstudios/core';
import type { AssistantPlan, PlanRunResult } from '@sevenstudios/ipc';
import { createEngine, type Engine } from '../api/createEngine';
import { cleanup, tempDir, testHost } from '../test/helpers';

const fixtures = path.resolve(__dirname, '../../../../tests/fixtures/generated');
const hasFixtures = fs.existsSync(path.join(fixtures, 'clip-10s-720p.mp4'));
let dir: string;
let engine: Engine;

afterEach(async () => {
  await engine?.dispose();
  cleanup(dir);
});

async function setup(file = 'clip-10s-720p.mp4') {
  dir = tempDir();
  engine = createEngine({ host: testHost(), paths: { userData: dir, resources: path.join(dir, 'res') }, logLevel: 'warn' });
  await engine.start();
  const project = await engine.invoke('projects.create', { name: 'ai', width: 1280, height: 720, fps: 30 });
  await engine.invoke('projects.open', { projectId: project.id });
  const imported = await engine.invoke('media.import', { paths: [path.join(fixtures, file)], projectId: project.id });
  const asset = imported.assets[0]!;
  const analyze = engine.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === asset.id)!;
  expect((await engine.tasks.wait(analyze.id)).status).toBe('done');
  await engine.invoke('media.addToTimeline', { projectId: project.id, assetId: asset.id });
  return { project, asset };
}

async function apply(projectId: string, plan: AssistantPlan): Promise<PlanRunResult> {
  const task = await engine.invoke('assistant.apply', { projectId, planId: plan.id });
  const done = await engine.tasks.wait(task.id);
  expect(done.status, JSON.stringify(done.error)).toBe('done');
  return done.result as PlanRunResult;
}

describe.skipIf(!hasFixtures)('assistant service', () => {
  it('plans and applies a bilingual editing request against the real document, verifying each step', async () => {
    const { project } = await setup();
    const before = getDocumentDurationMs((await engine.invoke('session.state', { projectId: project.id })).document);
    expect(before).toBe(10_000);
    // trim + colour look + speed: all deterministic, all feasible without any model
    const plan = await engine.invoke('assistant.plan', { projectId: project.id, text: 'احذف أول ثانيتين، خليه أبيض وأسود، وسرّع الفيديو مرتين' });
    expect(plan.language).toBe('ar');
    expect(plan.steps.map((s) => s.type)).toEqual(['trimStart', 'applyLook', 'changeSpeed']);
    expect(plan.steps.every((s) => s.feasible)).toBe(true);
    expect(plan.steps[1]!.targetClipIds).toHaveLength(1);
    expect(plan.requiresConfirmation).toBe(true);

    const result = await apply(project.id, plan);
    expect(result.doneCount).toBe(3);
    expect(result.failedCount).toBe(0);
    expect(result.steps.every((s) => s.verified)).toBe(true);
    const doc = (await engine.invoke('session.state', { projectId: project.id })).document;
    // 10s minus first 2s = 8s, then 2x speed ≈ 4s
    expect(getDocumentDurationMs(doc)).toBeLessThan(6_000);
    const clip = allClips(doc)[0]!;
    expect(clip.effects.some((e) => e.type === 'color')).toBe(true);
    expect(clip.speed).toBeCloseTo(2, 1);
    // undo the whole plan step by step, then the document is back to the start
    for (let i = 0; i < 3; i++) await engine.invoke('assistant.meta', { projectId: project.id, action: 'undo' });
    expect(getDocumentDurationMs((await engine.invoke('session.state', { projectId: project.id })).document)).toBe(10_000);
  });

  it('reports an infeasible operation honestly instead of faking it', async () => {
    const { project } = await setup();
    // no Whisper model is installed here, so subtitles must be gated with a reason, never silently succeed
    const plan = await engine.invoke('assistant.plan', { projectId: project.id, text: 'أضف ترجمة عربية' });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.type).toBe('generateSubtitles');
    expect(plan.steps[0]!.feasible).toBe(false);
    expect(plan.steps[0]!.capability).toBe('stt');
    expect(['needs-model', 'needs-runtime', 'unavailable']).toContain(plan.steps[0]!.capabilityStatus);

    const result = await apply(project.id, plan);
    expect(result.doneCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.steps[0]!.status).toBe('skipped');
    expect(result.reportEn.toLowerCase()).toContain('skipped');
  });

  it('resolves the duration-strategy question before it will run', async () => {
    const { project } = await setup();
    const draft = await engine.invoke('assistant.plan', { projectId: project.id, text: 'خلي الفيديو 4 ثواني' });
    expect(draft.steps[0]!.type).toBe('setDuration');
    expect(draft.clarifications).toHaveLength(1);
    await expect(engine.invoke('assistant.apply', { projectId: project.id, planId: draft.id })).rejects.toMatchObject({ info: { code: 'INVALID_INPUT' } });
    // answering the question produces a runnable plan
    const q = draft.clarifications[0]!;
    const resolved = await engine.invoke('assistant.plan', { projectId: project.id, text: 'خلي الفيديو 4 ثواني', choices: { [`${q.operationIndex}:${q.field}`]: 'trim-end' } });
    expect(resolved.clarifications).toHaveLength(0);
    const result = await apply(project.id, resolved);
    expect(result.doneCount).toBe(1);
    expect(getDocumentDurationMs((await engine.invoke('session.state', { projectId: project.id })).document)).toBe(4_000);
  });

  it('keeps a persisted conversation history', async () => {
    const { project } = await setup();
    await engine.invoke('assistant.plan', { projectId: project.id, text: 'اعكس الفيديو' });
    const history = await engine.invoke('assistant.history', { projectId: project.id });
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe('user');
    expect(history[1]!.role).toBe('assistant');
    expect(history[1]!.plan?.steps[0]!.type).toBe('reverse');
    await engine.invoke('assistant.clear', { projectId: project.id });
    expect(await engine.invoke('assistant.history', { projectId: project.id })).toHaveLength(0);
  });
});
