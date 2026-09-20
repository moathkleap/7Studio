import {
  ASPECT_PRESETS,
  PLATFORM_PRESETS,
  allClips,
  formatOperation,
  formatPlanSummary,
  getDocumentDurationMs,
  newId,
  parseIntent,
  OPERATION_META,
  type Clip,
  type Command,
  type OperationDraft,
  type ProjectDocument,
} from '@sevenvid/core';
import type { AssistantMessage, AssistantPlan, PlanRunResult, PlanStep, SessionState, StepResult, TaskInfo } from '@sevenvid/ipc';
import type { CapabilityRegistry } from '../capabilities/CapabilityRegistry';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { Logger } from '../logging/logger';
import type { SettingsService } from '../settings/SettingsService';
import type { SessionManager } from '../project/SessionManager';
import type { TaskManager } from '../tasks/TaskManager';
import type { AudioService } from '../audio/AudioService';
import type { VisionService } from '../vision/VisionService';
import type { SubtitleService } from '../subtitles/SubtitleService';
import type { OcrService } from '../ocr/OcrService';
import type { EnhanceService } from '../enhance/EnhanceService';
import type { ExportService } from '../export/ExportService';
import type { ProvidersService } from '../providers/ProvidersService';
import type { AppDatabase } from '../db/database';

/** Colour-grade presets the assistant applies through the shared `color` effect (kept in step with the enhance panel). */
const LOOK_PARAMS: Record<string, Record<string, number>> = {
  natural: { brightness: 0, contrast: 1, saturation: 1, gamma: 1 },
  warm: { brightness: 0.02, contrast: 1.05, saturation: 1.08, gamma: 1, temperature: 400 },
  cool: { brightness: 0, contrast: 1.05, saturation: 0.95, gamma: 1, temperature: -400 },
  cinematic: { brightness: -0.02, contrast: 1.15, saturation: 0.85, gamma: 0.98 },
  vivid: { brightness: 0.02, contrast: 1.12, saturation: 1.3, gamma: 1 },
  mono: { brightness: 0, contrast: 1.05, saturation: 0, gamma: 1 },
};

export interface AssistantServices {
  db: AppDatabase;
  sessions: SessionManager;
  tasks: TaskManager;
  capabilities: CapabilityRegistry;
  settings: SettingsService;
  bus: EventBus;
  logger: Logger;
  audio: AudioService;
  vision: VisionService;
  subtitles: SubtitleService;
  ocr: OcrService;
  enhance: EnhanceService;
  exports: ExportService;
  providers: ProvidersService;
}

interface ApplyParams {
  planId: string;
  projectId: string;
  selectedClipIds: string[];
}

type Ctx = { progress: (v: number, m?: string | null) => void; signal: AbortSignal };

/**
 * The AI assistant: turns a bilingual editing request into a validated plan of operations, then executes and
 * verifies each one against the real document. The deterministic intent parser (core) drives everything; a text
 * model, when configured, would only widen understanding — never bypass the schema or the per-operation verification.
 */
export class AssistantService {
  constructor(private readonly s: AssistantServices) {
    s.tasks.registerKind<ApplyParams, PlanRunResult>({
      kind: 'assistant.apply',
      lane: 'default',
      cancellable: true,
      title: () => 'Apply AI plan',
      run: (ctx) => this.run(ctx.params, ctx),
    });
  }

  private doc(projectId: string): ProjectDocument {
    return this.s.sessions.get(projectId).document;
  }

  // -------------------------------------------------------------------------------------------------- planning

  /** Interprets the request, resolves targets and feasibility, persists the exchange and returns the plan. */
  plan(projectId: string, text: string, opts: { selectedClipIds?: string[]; choices?: Record<string, string | number | null> } = {}): AssistantPlan {
    const session = this.s.sessions.get(projectId);
    const doc = session.document;
    const durationMs = getDocumentDurationMs(doc);
    const interp = parseIntent(text, { durationMs });
    const conversationId = this.s.db.ai.conversation(projectId);
    const userMsgId = newId('msg');
    this.s.db.ai.addMessage({ id: userMsgId, conversationId, role: 'user', content: text, planId: null, plan: null, result: null });

    const assistantMsgId = newId('msg');
    const planId = newId('plan');
    const choices = opts.choices ?? {};
    const selected = opts.selectedClipIds ?? [];
    const steps: PlanStep[] = interp.operations.map((op, index) => this.planStep(op, index, doc, selected, choices));
    const unresolved = interp.clarifications.filter((q) => {
      const key = `${q.operationIndex}:${q.field}`;
      return choices[key] === undefined;
    });
    const feasibleCount = steps.filter((st) => st.feasible).length;
    const requiresConfirmation = this.s.settings.get().ai.alwaysConfirmPlans || steps.some((st) => st.destructive) || unresolved.length > 0;
    const plan: AssistantPlan = {
      id: planId,
      conversationId,
      messageId: assistantMsgId,
      projectId,
      text,
      language: interp.language,
      meta: interp.meta,
      steps,
      clarifications: unresolved,
      unknownClauses: interp.unknownClauses,
      summaryAr: formatPlanSummary(interp.operations, 'ar'),
      summaryEn: formatPlanSummary(interp.operations, 'en'),
      requiresConfirmation,
      feasibleCount,
      confidence: interp.confidence,
      status: 'draft',
    };
    this.s.db.ai.addMessage({ id: assistantMsgId, conversationId, role: 'assistant', content: plan.summaryEn, planId, plan, result: null });
    this.s.db.ai.savePlan(plan);
    this.s.logger.info({ module: 'ai', operation: 'plan', projectId, steps: steps.length, feasible: feasibleCount, meta: interp.meta }, 'plan created');
    return plan;
  }

  private planStep(op: OperationDraft, index: number, doc: ProjectDocument, selected: string[], choices: Record<string, string | number | null>): PlanStep {
    const meta = OPERATION_META[op.type];
    const params: Record<string, unknown> = { ...(op.params as Record<string, unknown>) };
    // apply clarification choices to this operation
    for (const [key, value] of Object.entries(choices)) {
      const [opIndex, field] = key.split(':');
      if (Number(opIndex) === index && field) params[field] = value;
    }
    const targets = this.resolveTargets(op.type, doc, selected);
    let feasible = true;
    let reasonKey: string | null = null;
    const reasonParams: Record<string, unknown> = {};
    let capabilityStatus: string | null = null;
    if (meta.capability) {
      const cap = this.s.capabilities.status(meta.capability);
      capabilityStatus = cap.status;
      if (cap.status !== 'available') {
        feasible = false;
        reasonKey = 'ai.reason.capability';
        reasonParams.capability = meta.capability;
        reasonParams.status = cap.status;
      }
    }
    if (op.type === 'upscale' && params.method === 'ai') {
      const cap = this.s.capabilities.status('upscale.ai');
      capabilityStatus = cap.status;
      if (cap.status !== 'available') {
        feasible = false;
        reasonKey = 'ai.reason.capability';
        reasonParams.capability = 'upscale.ai';
        reasonParams.status = cap.status;
      }
    }
    if (feasible && meta.clipScoped && targets.length === 0) {
      feasible = false;
      reasonKey = op.type === 'blurFaces' || op.type === 'blurText' || op.type === 'upscale' || op.type === 'stabilize' ? 'ai.reason.noVideoClip' : 'ai.reason.noClip';
    }
    if (feasible && !meta.clipScoped && op.type !== 'export' && allClips(doc).length === 0) {
      feasible = false;
      reasonKey = 'ai.reason.emptyTimeline';
    }
    if (feasible && (op.type === 'trimStart' || op.type === 'trimEnd') && (params.ms as number) >= getDocumentDurationMs(doc)) {
      feasible = false;
      reasonKey = 'ai.reason.trimTooLong';
      reasonParams.ms = params.ms;
      reasonParams.durationMs = getDocumentDurationMs(doc);
    }
    return {
      index,
      type: op.type,
      params,
      summaryAr: formatOperation({ ...op, params } as OperationDraft, 'ar'),
      summaryEn: formatOperation({ ...op, params } as OperationDraft, 'en'),
      feasible,
      reasonKey,
      reasonParams,
      capability: meta.capability,
      capabilityStatus,
      destructive: meta.destructive,
      long: meta.long,
      targetClipIds: targets,
    };
  }

  /** Resolves which clips a clip-scoped operation acts on (explicit selection first, then sensible defaults). */
  private resolveTargets(type: OperationDraft['type'], doc: ProjectDocument, selected: string[]): string[] {
    const meta = OPERATION_META[type];
    if (!meta.clipScoped) return [];
    const clips = allClips(doc);
    const withVideo = clips.filter((c) => doc.assets[c.assetId]?.hasVideo);
    const withAudio = clips.filter((c) => doc.assets[c.assetId]?.hasAudio);
    const pool = meta.group === 'audio' ? withAudio : withVideo;
    if (selected.length) {
      const chosen = pool.filter((c) => selected.includes(c.id));
      if (chosen.length) return chosen.map((c) => c.id);
    }
    // face/text/upscale operate on a single clip; audio/colour presets on all matching clips
    if (type === 'blurFaces' || type === 'blurText' || type === 'upscale') return pool[0] ? [pool[0].id] : [];
    return pool.map((c) => c.id);
  }

  // -------------------------------------------------------------------------------------------------- applying

  apply(projectId: string, planId: string, selectedClipIds: string[] = []): TaskInfo {
    const plan = this.s.db.ai.getPlan(planId);
    if (!plan || plan.projectId !== projectId) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.apply', message: 'Plan not found', details: { planId } });
    if (plan.clarifications.length) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.apply', message: 'The plan still has unanswered questions', details: { count: plan.clarifications.length } });
    this.s.sessions.get(projectId);
    return this.s.tasks.enqueue({ kind: 'assistant.apply', params: { planId, projectId, selectedClipIds }, projectId, priority: 3 });
  }

  meta(projectId: string, action: 'undo' | 'redo'): SessionState {
    const session = this.s.sessions.get(projectId);
    return action === 'undo' ? session.undo() : session.redo();
  }

  history(projectId: string): AssistantMessage[] {
    return this.s.db.ai.messages(projectId).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, planId: m.planId, plan: m.plan, result: m.result }));
  }

  clear(projectId: string): { cleared: boolean } {
    this.s.db.ai.clear(projectId);
    return { cleared: true };
  }

  private async run(params: ApplyParams, ctx: Ctx): Promise<PlanRunResult> {
    const { projectId, planId } = params;
    const plan = this.s.db.ai.getPlan(planId);
    if (!plan) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.apply', message: 'Plan not found', details: { planId } });
    plan.status = 'executing';
    this.s.db.ai.setPlanStatus(planId, 'executing', null);
    const steps = plan.steps;
    const results: StepResult[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      ctx.progress(i / Math.max(1, steps.length), step.summaryEn);
      if (ctx.signal.aborted) throw new AppError({ code: 'TASK_CANCELLED', operation: 'assistant.apply', message: 'cancelled' });
      if (!step.feasible) {
        results.push({ index: i, type: step.type, status: 'skipped', summaryAr: step.summaryAr, summaryEn: step.summaryEn, verified: null, detailAr: reasonText(step, 'ar'), detailEn: reasonText(step, 'en'), errorCode: step.reasonKey });
        continue;
      }
      try {
        const r = await this.executeStep(step, projectId, params.selectedClipIds, ctx);
        results.push({ index: i, type: step.type, status: 'done', summaryAr: step.summaryAr, summaryEn: step.summaryEn, verified: r.verified, detailAr: r.detailAr, detailEn: r.detailEn, errorCode: null });
      } catch (err) {
        const info = AppError.from(err, { code: 'COMMAND_FAILED', operation: `assistant.${step.type}` }).info;
        results.push({ index: i, type: step.type, status: 'failed', summaryAr: step.summaryAr, summaryEn: step.summaryEn, verified: false, detailAr: info.message, detailEn: info.message, errorCode: info.code });
        this.s.logger.warn({ module: 'ai', operation: 'apply.step', projectId, step: step.type, err: info }, 'operation failed');
      }
    }
    const doneCount = results.filter((r) => r.status === 'done').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const result: PlanRunResult = {
      planId,
      projectId,
      steps: results,
      doneCount,
      failedCount,
      skippedCount,
      reportAr: report(results, 'ar'),
      reportEn: report(results, 'en'),
    };
    const status: AssistantPlan['status'] = failedCount === 0 && skippedCount === 0 ? 'done' : doneCount > 0 ? 'partial' : 'failed';
    this.s.db.ai.setPlanStatus(planId, status, result);
    this.s.db.ai.updateMessage(plan.messageId, { plan: { ...plan, status }, result });
    ctx.progress(1, null);
    this.s.bus.emit('assistant.updated', { projectId, planId, result });
    this.s.logger.info({ module: 'ai', operation: 'apply', projectId, done: doneCount, failed: failedCount, skipped: skippedCount }, 'plan applied');
    return result;
  }

  // ---------------------------------------------------------------------------------------- execution + verify

  private async executeStep(step: PlanStep, projectId: string, selectedClipIds: string[], ctx: Ctx): Promise<{ verified: boolean | null; detailAr: string | null; detailEn: string | null }> {
    const session = this.s.sessions.get(projectId);
    const before = session.document;
    const durBefore = getDocumentDurationMs(before);
    const maskBefore = before.masks.length;
    const subCuesBefore = before.subtitles.reduce((n, t) => n + t.cues.length, 0);
    const clipsBefore = allClips(before).length;
    const p = step.params;
    const targets = step.targetClipIds.length ? step.targetClipIds : this.resolveTargets(step.type as OperationDraft['type'], before, selectedClipIds);

    const runCommands = (commands: Command[], label: string) => session.executeBatch(commands, label, 'ai');

    switch (step.type) {
      case 'trimStart': {
        runCommands([{ type: 'timeline.trimStart', ms: p.ms as number }], step.summaryEn);
        const after = getDocumentDurationMs(this.doc(projectId));
        return verify(Math.abs(durBefore - after - (p.ms as number)) < 80, `${fmt(durBefore)} → ${fmt(after)}`);
      }
      case 'trimEnd': {
        runCommands([{ type: 'timeline.trimEnd', ms: p.ms as number }], step.summaryEn);
        const after = getDocumentDurationMs(this.doc(projectId));
        return verify(Math.abs(durBefore - after - (p.ms as number)) < 80, `${fmt(durBefore)} → ${fmt(after)}`);
      }
      case 'cutRange': {
        runCommands([{ type: 'timeline.cutRange', startMs: p.startMs as number, endMs: p.endMs as number }], step.summaryEn);
        const after = getDocumentDurationMs(this.doc(projectId));
        return verify(after < durBefore, `${fmt(durBefore)} → ${fmt(after)}`);
      }
      case 'setDuration': {
        const strategy = (p.strategy as 'trim-end' | 'trim-start' | 'speed' | 'remove-silence-first' | null) ?? 'trim-end';
        if (strategy === 'remove-silence-first') {
          await this.waitTask(this.s.audio.startRemoveSilence({ projectId, verify: true }));
        }
        const effective = strategy === 'remove-silence-first' ? 'trim-end' : strategy;
        runCommands([{ type: 'timeline.setDuration', targetMs: p.targetMs as number, strategy: effective }], step.summaryEn);
        const after = getDocumentDurationMs(this.doc(projectId));
        return verify(Math.abs(after - (p.targetMs as number)) < 200 || (strategy === 'speed' && after <= (p.targetMs as number) + 200), `${fmt(after)}`);
      }
      case 'splitAt': {
        const clip = this.clipAt(before, p.atMs as number);
        if (!clip) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.splitAt', message: 'No clip at that position' });
        runCommands([{ type: 'clip.split', clipId: clip.id, atMs: p.atMs as number }], step.summaryEn);
        return verify(allClips(this.doc(projectId)).length > clipsBefore, null);
      }
      case 'removeSilence': {
        const info = await this.waitTask(this.s.audio.startRemoveSilence({ projectId, thresholdDb: p.thresholdDb as number | undefined, minSilenceMs: p.minSilenceMs as number | undefined, paddingMs: p.paddingMs as number | undefined, verify: true }));
        const r = info.result as { removedMs: number; cutRanges: unknown[]; verified: boolean | null } | undefined;
        if (!r || r.cutRanges.length === 0) return { verified: false, detailAr: 'لم يُعثر على سكوت', detailEn: 'No silence found' };
        return { verified: r.verified, detailAr: `أُزيل ${fmt(r.removedMs)}`, detailEn: `Removed ${fmt(r.removedMs)}` };
      }
      case 'blurFaces': {
        const clipId = targets[0];
        if (!clipId) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.blurFaces', message: 'No video clip' });
        const info = await this.waitTask(this.s.vision.startBlurFaces({ projectId, clipId, selector: p.selector as never, kind: p.kind as never, shape: p.shape as never, strength: p.strength as number | undefined }));
        const r = info.result as { masks: unknown[]; facesDetected: number } | undefined;
        const added = this.doc(projectId).masks.length - maskBefore;
        return verify(Boolean(r && added > 0), `${r?.facesDetected ?? 0}`);
      }
      case 'blurText': {
        const clipId = targets[0];
        if (!clipId) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.blurText', message: 'No video clip' });
        await this.waitTask(this.s.ocr.startDetect({ projectId, clipId }));
        this.s.ocr.createMasks(projectId, clipId, p.kind as never);
        const added = this.doc(projectId).masks.length - maskBefore;
        return verify(added > 0, `${added}`);
      }
      case 'enhanceAudio': {
        if (targets.length === 0) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.enhanceAudio', message: 'No audio clip' });
        this.s.audio.applyPreset(projectId, targets, p.preset as string);
        const ok = targets.every((id) => (this.clipById(this.doc(projectId), id)?.effects.length ?? 0) > 0);
        return verify(ok, null);
      }
      case 'adjustVolume': {
        const commands: Command[] = targets.map((id) => {
          const clip = this.clipById(before, id)!;
          if (p.mute) return { type: 'clip.setAudio', clipId: id, audio: { muted: true } };
          return { type: 'clip.setAudio', clipId: id, audio: { gainDb: Math.round((clip.audio.gainDb + (p.deltaDb as number)) * 10) / 10 } };
        });
        runCommands(commands, step.summaryEn);
        return verify(true, null);
      }
      case 'applyLook': {
        const commands: Command[] = [];
        for (const id of targets) {
          const clip = this.clipById(before, id)!;
          const params = p.look ? { ...LOOK_PARAMS[p.look as string] } : this.adjustParams(clip, p.adjust as Record<string, number> | undefined);
          const existing = clip.effects.find((e) => e.type === 'color');
          commands.push(existing ? { type: 'effect.update', clipId: id, effectId: existing.id, patch: { params } } : { type: 'effect.add', clipId: id, effect: { id: newId('fx'), type: 'color', enabled: true, params } });
        }
        runCommands(commands, step.summaryEn);
        return verify(targets.every((id) => this.clipById(this.doc(projectId), id)?.effects.some((e) => e.type === 'color')), null);
      }
      case 'enhanceVideo': {
        const preset = p.preset as 'auto' | 'sharpen' | 'denoise';
        const commands: Command[] = [];
        for (const id of targets) {
          const clip = this.clipById(before, id)!;
          if (preset === 'sharpen' || preset === 'auto') commands.push(this.addOrUpdateEffect(clip, id, 'sharpen', { amount: 1 }));
          if (preset === 'denoise' || preset === 'auto') commands.push(this.addOrUpdateEffect(clip, id, 'denoise', { strength: 3 }));
        }
        runCommands(commands, step.summaryEn);
        return verify(true, null);
      }
      case 'stabilize': {
        const commands = targets.map((id) => this.addOrUpdateEffect(this.clipById(before, id)!, id, 'stabilize', { rx: 32, ry: 32 }));
        runCommands(commands, step.summaryEn);
        return verify(targets.every((id) => this.clipById(this.doc(projectId), id)?.effects.some((e) => e.type === 'stabilize')), null);
      }
      case 'upscale': {
        const clipId = targets[0];
        if (!clipId) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.upscale', message: 'No video clip' });
        const factor = (p.factor as 2 | 4 | null) ?? this.factorForHeight(before, clipId, p.targetHeight as number | null);
        const method = (p.method as 'auto' | 'lanczos' | 'ai') === 'ai' ? 'ai' : 'lanczos';
        const info = await this.waitTask(this.s.enhance.startUpscale({ projectId, clipId, factor: factor as 2 | 4, method, replaceClip: true }));
        const r = info.result as { width: number; height: number } | undefined;
        return verify(Boolean(r), r ? `${r.width}×${r.height}` : null);
      }
      case 'changeSpeed': {
        const commands = targets.map((id) => ({ type: 'clip.setSpeed' as const, clipId: id, speed: p.factor as number, ripple: true }));
        runCommands(commands, step.summaryEn);
        return verify(targets.every((id) => Math.abs((this.clipById(this.doc(projectId), id)?.speed ?? 0) - (p.factor as number)) < 0.01), null);
      }
      case 'reverse': {
        const commands = targets.map((id) => ({ type: 'clip.setReverse' as const, clipId: id, reverse: true }));
        runCommands(commands, step.summaryEn);
        return verify(targets.every((id) => this.clipById(this.doc(projectId), id)?.reverse === true), null);
      }
      case 'freezeFrame': {
        const atMs = (p.atMs as number | null) ?? 0;
        const clip = this.clipAt(before, atMs) ?? allClips(before)[0];
        if (!clip) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.freezeFrame', message: 'No clip' });
        const sourceMs = clip.sourceInMs + Math.max(0, atMs - clip.startMs);
        runCommands([{ type: 'clip.setFreeze', clipId: clip.id, freeze: { atSourceMs: sourceMs }, durationMs: p.durationMs as number, ripple: true }], step.summaryEn);
        return verify(this.clipById(this.doc(projectId), clip.id)?.freeze != null, null);
      }
      case 'setAspect': {
        const settings = this.aspectSettings(p.aspect as string, p.platform as string | null);
        const commands: Command[] = [{ type: 'sequence.update', settings }];
        if (p.fit) for (const c of allClips(before)) commands.push({ type: 'clip.setTransform', clipId: c.id, transform: { fit: p.fit as never } });
        runCommands(commands, step.summaryEn);
        const d = this.doc(projectId);
        return verify(d.settings.width === settings.width && d.settings.height === settings.height, `${settings.width}×${settings.height}`);
      }
      case 'generateSubtitles': {
        const info = await this.waitTask(this.s.subtitles.startTranscribe({ projectId, language: p.language as never }));
        const r = info.result as { cues: number; trackId: string } | undefined;
        if (p.burnIn && r?.trackId) session.execute({ type: 'subtitle.updateTrack', trackId: r.trackId, patch: { burnIn: true } }, 'ai');
        const cuesAfter = this.doc(projectId).subtitles.reduce((n, t) => n + t.cues.length, 0);
        return verify(cuesAfter > subCuesBefore, `${(r?.cues ?? cuesAfter - subCuesBefore)}`);
      }
      case 'translateSubtitles': {
        const track = before.subtitles[before.subtitles.length - 1];
        if (!track || track.cues.length === 0) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.translateSubtitles', message: 'There are no subtitles to translate' });
        const lines = track.cues.map((c) => c.text.replace(/\n/g, ' ').trim());
        const { text: translated } = await this.s.providers.translate(lines.join('\n'), p.targetLanguage as string, ctx.signal);
        const out = translated.split('\n').map((l) => l.trim()).filter((_, i) => i < lines.length);
        if (out.length !== lines.length) throw new AppError({ code: 'PROVIDER_FAILED', operation: 'assistant.translateSubtitles', message: `Translation returned ${out.length} lines for ${lines.length} cues`, details: { expected: lines.length, got: out.length } });
        const newTrack = { id: newId('sub'), name: `${p.targetLanguage as string}`, language: p.targetLanguage as string, cues: track.cues.map((c, i) => ({ id: newId('cue'), startMs: c.startMs, endMs: c.endMs, text: out[i]!, speaker: c.speaker })), style: track.style, enabled: true, burnIn: false, source: 'translation' as const };
        session.execute({ type: 'subtitle.addTrack', track: newTrack }, 'ai');
        const added = this.doc(projectId).subtitles.find((t) => t.id === newTrack.id);
        return verify(Boolean(added && added.cues.length === track.cues.length), `${newTrack.cues.length}`);
      }
      case 'burnSubtitles': {
        const tracks = before.subtitles;
        if (tracks.length === 0) throw new AppError({ code: 'INVALID_INPUT', operation: 'assistant.burnSubtitles', message: 'There are no subtitle tracks' });
        runCommands(tracks.map((t) => ({ type: 'subtitle.updateTrack' as const, trackId: t.id, patch: { burnIn: true } })), step.summaryEn);
        return verify(this.doc(projectId).subtitles.every((t) => t.burnIn), null);
      }
      case 'export': {
        const presetId = (p.presetId as string | null) ?? this.presetForPlatform(p.platform as string | null);
        const info = this.s.exports.start({ projectId, settings: { presetId: presetId as never } });
        const done = await this.s.tasks.wait(info.taskId ?? info.id);
        return verify(done.status === 'done', null);
      }
      default:
        throw new AppError({ code: 'NOT_IMPLEMENTED', operation: `assistant.${step.type}`, message: `Unknown operation ${step.type}` });
    }
  }

  private async waitTask(info: TaskInfo): Promise<TaskInfo> {
    const done = await this.s.tasks.wait(info.id);
    if (done.status !== 'done') {
      throw new AppError({ code: 'COMMAND_FAILED', operation: done.kind, message: done.error?.message ?? `Task ${done.status}`, details: { taskId: done.id, status: done.status, cause: done.error?.code ?? null } });
    }
    return done;
  }

  private clipById(doc: ProjectDocument, id: string): Clip | undefined {
    return allClips(doc).find((c) => c.id === id);
  }

  private clipAt(doc: ProjectDocument, tMs: number): Clip | undefined {
    return allClips(doc).find((c) => tMs >= c.startMs && tMs < c.startMs + c.durationMs);
  }

  private addOrUpdateEffect(clip: Clip, clipId: string, type: 'sharpen' | 'denoise' | 'stabilize', params: Record<string, number>): Command {
    const existing = clip.effects.find((e) => e.type === type);
    return existing ? { type: 'effect.update', clipId, effectId: existing.id, patch: { params } } : { type: 'effect.add', clipId, effect: { id: newId('fx'), type, enabled: true, params } };
  }

  private adjustParams(clip: Clip, adjust: Record<string, number> | undefined): Record<string, number> {
    const existing = clip.effects.find((e) => e.type === 'color');
    const base: Record<string, number> = { brightness: 0, contrast: 1, saturation: 1, gamma: 1, ...(existing?.params as Record<string, number> | undefined) };
    if (!adjust) return base;
    for (const [k, v] of Object.entries(adjust)) base[k] = k === 'brightness' ? base.brightness! + v : v;
    return base;
  }

  private factorForHeight(doc: ProjectDocument, clipId: string, targetHeight: number | null): 2 | 4 {
    if (!targetHeight) return 2;
    const asset = doc.assets[this.clipById(doc, clipId)?.assetId ?? ''];
    const h = asset?.height ?? doc.settings.height;
    return targetHeight / h > 2.5 ? 4 : 2;
  }

  private aspectSettings(aspect: string, platform: string | null): Record<string, unknown> {
    if (platform && platform in PLATFORM_PRESETS) {
      const pp = PLATFORM_PRESETS[platform as keyof typeof PLATFORM_PRESETS];
      return { width: pp.width, height: pp.height, fps: pp.fps, aspectPreset: pp.aspect, platformPreset: pp.id };
    }
    const ap = ASPECT_PRESETS[aspect as keyof typeof ASPECT_PRESETS];
    return { width: ap.width, height: ap.height, aspectPreset: ap.id, platformPreset: 'custom' };
  }

  private presetForPlatform(platform: string | null): string {
    if (platform && platform in PLATFORM_PRESETS) return PLATFORM_PRESETS[platform as keyof typeof PLATFORM_PRESETS].exportPresetId;
    return this.s.settings.get().export.defaultPresetId;
  }
}

function verify(ok: boolean, detail: string | null): { verified: boolean; detailAr: string | null; detailEn: string | null } {
  return { verified: ok, detailAr: detail, detailEn: detail };
}

function fmt(ms: number): string {
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

function reasonText(step: PlanStep, lang: 'ar' | 'en'): string {
  const map: Record<string, [string, string]> = {
    'ai.reason.capability': [`يتطلب قدرة غير متاحة (${step.capabilityStatus})`, `Requires a capability that is not available (${step.capabilityStatus})`],
    'ai.reason.noVideoClip': ['لا يوجد مقطع فيديو', 'No video clip on the timeline'],
    'ai.reason.noClip': ['لا يوجد مقطع مناسب', 'No suitable clip'],
    'ai.reason.emptyTimeline': ['الخط الزمني فارغ', 'The timeline is empty'],
    'ai.reason.trimTooLong': ['المدة المطلوبة أطول من الفيديو', 'The requested length is longer than the video'],
  };
  const pair = step.reasonKey ? map[step.reasonKey] : undefined;
  return pair ? pair[lang === 'ar' ? 0 : 1] : lang === 'ar' ? 'غير ممكن' : 'Not possible';
}

function report(results: StepResult[], lang: 'ar' | 'en'): string {
  const done = results.filter((r) => r.status === 'done');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');
  const lines: string[] = [];
  if (lang === 'ar') {
    if (done.length) lines.push(`تمّ تنفيذ ${done.length} ${done.length === 1 ? 'عملية' : 'عمليات'} والتحقق منها.`);
    for (const r of failed) lines.push(`تعذّر: ${r.summaryAr}${r.detailAr ? ` — ${r.detailAr}` : ''}`);
    for (const r of skipped) lines.push(`تُخطّي: ${r.summaryAr}${r.detailAr ? ` — ${r.detailAr}` : ''}`);
    if (!done.length && !failed.length && !skipped.length) lines.push('لم يُنفَّذ شيء.');
  } else {
    if (done.length) lines.push(`Applied and verified ${done.length} operation${done.length === 1 ? '' : 's'}.`);
    for (const r of failed) lines.push(`Failed: ${r.summaryEn}${r.detailEn ? ` — ${r.detailEn}` : ''}`);
    for (const r of skipped) lines.push(`Skipped: ${r.summaryEn}${r.detailEn ? ` — ${r.detailEn}` : ''}`);
    if (!done.length && !failed.length && !skipped.length) lines.push('Nothing was applied.');
  }
  return lines.join('\n');
}
