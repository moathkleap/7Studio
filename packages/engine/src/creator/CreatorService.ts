import fs from 'node:fs';
import path from 'node:path';
import {
  ASPECT_PRESETS,
  BriefSchema,
  buildScript,
  createClip,
  createDocument,
  createSubtitleTrack,
  formatAssTime,
  newId,
  reviewScript,
  type Brief,
  type Character,
  type CreatorScene,
  type CreatorQaIssue,
  type ProductionMode,
  type Script,
  type SequenceSettings,
} from '@sevenstudios/core';
import type { TaskInfo } from '@sevenstudios/ipc';
import type { AppDatabase } from '../db/database';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import { runFfmpeg } from '../ffmpeg/runner';
import type { FfmpegLocation } from '../ffmpeg/locator';
import { escapeFilterPath } from '../render/filterUtils';
import type { Logger } from '../logging/logger';
import type { CapabilityRegistry } from '../capabilities/CapabilityRegistry';
import type { MediaService } from '../media/MediaService';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { TaskManager } from '../tasks/TaskManager';
import type { WorkerService } from '../worker/WorkerService';

export interface CreatorServices {
  db: AppDatabase;
  ffmpeg: FfmpegLocation;
  tasks: TaskManager;
  projects: ProjectService;
  sessions: SessionManager;
  media: MediaService;
  capabilities: CapabilityRegistry;
  worker: WorkerService;
  bus: EventBus;
  logger: Logger;
}

export interface CreatorState {
  brief: Brief | null;
  script: Script | null;
  characters: Character[];
  scenes: CreatorScene[];
  productionMode: ProductionMode;
  productionReason: string | null;
}

type Ctx = { progress: (v: number, m?: string | null) => void; signal: AbortSignal };

const CARD_HUES = [222, 265, 12, 160, 40, 300, 190, 90];

/**
 * AI Video Creator: idea → brief → script → characters → scenes → storyboard → voice → assembly → review → export.
 * When no image/video generation model is installed it produces an honest **animatic** (storyboard cards + real
 * voiceover + subtitles assembled onto the editor timeline), clearly labelled — never a fake "generated" video.
 */
export class CreatorService {
  constructor(private readonly s: CreatorServices) {
    s.tasks.registerKind<{ projectId: string; sceneIds: string[] }, { rendered: number }>({ kind: 'creator.storyboard', lane: 'default', title: () => 'Render storyboard', run: (ctx) => this.renderStoryboard(ctx.params, ctx) });
    s.tasks.registerKind<{ projectId: string; sceneIds: string[] }, { voiced: number; skipped: number }>({ kind: 'creator.voice', lane: 'default', title: () => 'Synthesize voiceover', run: (ctx) => this.synthVoice(ctx.params, ctx) });
    s.tasks.registerKind<{ projectId: string }, { scenes: number; durationMs: number }>({ kind: 'creator.assemble', lane: 'default', title: () => 'Assemble the animatic', run: (ctx) => this.assemble(ctx.params, ctx) });
  }

  // ------------------------------------------------------------------------------------------------------ state

  productionMode(): { mode: ProductionMode; reason: string | null } {
    if (this.s.capabilities.status('gen.video').status === 'available') return { mode: 'video-model', reason: null };
    if (this.s.capabilities.status('gen.image').status === 'available') return { mode: 'image-model', reason: null };
    return { mode: 'animatic', reason: 'no-generation-model' };
  }

  state(projectId: string): CreatorState {
    this.s.projects.get(projectId);
    const { brief, script } = this.s.db.creator.getBriefScript(projectId);
    const pm = this.productionMode();
    return { brief, script, characters: this.s.db.creator.characters(projectId), scenes: this.s.db.creator.scenes(projectId), productionMode: pm.mode, productionReason: pm.reason };
  }

  private dataDir(projectId: string, ...parts: string[]): string {
    const dir = path.join(this.s.projects.get(projectId).dataDir, 'generated', ...parts);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // The brief only chooses a production canvas (aspect ratio). The target social platform(s) are
  // picked later, after editing, on the Publish screen — a single edit can be published to many.
  private sequenceForBrief(brief: Brief): Pick<SequenceSettings, 'width' | 'height' | 'aspectPreset' | 'platformPreset'> {
    const ap = ASPECT_PRESETS[brief.aspect as keyof typeof ASPECT_PRESETS];
    return { width: ap.width, height: ap.height, aspectPreset: ap.id, platformPreset: 'custom' };
  }

  // ------------------------------------------------------------------------------------------------ brief/script

  /** Captures the brief, builds a first-draft script and scene list, and sets the sequence to the chosen aspect. */
  setBrief(projectId: string, input: unknown): CreatorState {
    this.s.projects.get(projectId);
    const brief = BriefSchema.parse(input);
    const characters = this.s.db.creator.characters(projectId);
    const script = buildScript(brief, characters);
    this.s.db.creator.saveBriefScript(projectId, brief, script);
    this.syncScenes(projectId, script);
    // apply the aspect to the open session's sequence
    if (this.s.sessions.isOpen(projectId)) {
      this.s.sessions.get(projectId).execute({ type: 'sequence.update', settings: this.sequenceForBrief(brief) }, 'creator');
    }
    this.s.bus.emit('creator.updated', { projectId });
    this.s.logger.info({ module: 'creator', operation: 'brief', projectId, scenes: script.scenes.length }, 'brief captured');
    return this.state(projectId);
  }

  /** Persists an edited script and re-syncs scene rows, preserving already-produced assets by scene id. */
  updateScript(projectId: string, script: Script): CreatorState {
    const { brief } = this.s.db.creator.getBriefScript(projectId);
    if (!brief) throw new AppError({ code: 'INVALID_INPUT', operation: 'creator.updateScript', message: 'Set a brief first' });
    this.s.db.creator.saveBriefScript(projectId, brief, script);
    this.syncScenes(projectId, script);
    this.s.bus.emit('creator.updated', { projectId });
    return this.state(projectId);
  }

  private syncScenes(projectId: string, script: Script): void {
    const existing = new Map(this.s.db.creator.scenes(projectId).map((s) => [s.id, s]));
    const scenes: CreatorScene[] = script.scenes.map((sc, index) => {
      const prev = existing.get(sc.id);
      // if the scene text changed, invalidate produced assets so nothing stale is presented as current
      const changed = prev && (prev.scene.narration !== sc.narration || prev.scene.heading !== sc.heading);
      return {
        id: sc.id,
        index,
        scene: sc,
        status: prev && !changed ? prev.status : 'draft',
        storyboardPath: prev && !changed ? prev.storyboardPath : null,
        voicePath: prev && !changed ? prev.voicePath : null,
        voiceMs: prev && !changed ? prev.voiceMs : null,
        generatedAssetId: prev && !changed ? prev.generatedAssetId : null,
        consistency: prev && !changed ? prev.consistency : null,
      };
    });
    this.s.db.creator.replaceScenes(projectId, scenes);
  }

  // -------------------------------------------------------------------------------------------------- characters

  saveCharacter(projectId: string, character: Character): CreatorState {
    this.s.projects.get(projectId);
    const id = character.id || newId('chr');
    this.s.db.creator.upsertCharacter(projectId, { ...character, id }, null);
    this.s.bus.emit('creator.updated', { projectId });
    return this.state(projectId);
  }

  removeCharacter(projectId: string, characterId: string): CreatorState {
    this.s.db.creator.removeCharacter(characterId);
    this.s.bus.emit('creator.updated', { projectId });
    return this.state(projectId);
  }

  /** Computes a face embedding for a character's reference image so scene consistency can be checked later. */
  async embedCharacter(projectId: string, characterId: string, imagePath: string): Promise<CreatorState> {
    const character = this.s.db.creator.characters(projectId).find((c) => c.id === characterId);
    if (!character) throw new AppError({ code: 'INVALID_INPUT', operation: 'creator.embedCharacter', message: 'Character not found' });
    const res = await this.s.worker.embedFaces(imagePath);
    const best = res.faces.sort((a, b) => b.score - a.score)[0];
    if (!best) throw new AppError({ code: 'NO_FACES_FOUND', operation: 'creator.embedCharacter', message: 'No face found in the reference image' });
    const buf = Buffer.from(new Float32Array(best.embedding).buffer);
    this.s.db.creator.upsertCharacter(projectId, { ...character, referenceImages: [...new Set([...character.referenceImages, imagePath])], hasEmbedding: true }, buf);
    this.s.bus.emit('creator.updated', { projectId });
    return this.state(projectId);
  }

  // --------------------------------------------------------------------------------------------------- storyboard

  startStoryboard(projectId: string, sceneIds?: string[]): TaskInfo {
    this.requireScenes(projectId);
    return this.s.tasks.enqueue({ kind: 'creator.storyboard', params: { projectId, sceneIds: sceneIds ?? [] }, projectId, priority: 4 });
  }

  private async renderStoryboard(p: { projectId: string; sceneIds: string[] }, ctx: Ctx): Promise<{ rendered: number }> {
    const { projectId } = p;
    const brief = this.requireBrief(projectId);
    const seq = this.sequenceForBrief(brief);
    const scenes = this.targetScenes(projectId, p.sceneIds);
    const dir = this.dataDir(projectId, 'storyboard');
    let rendered = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (ctx.signal.aborted) throw new AppError({ code: 'TASK_CANCELLED', operation: 'creator.storyboard', message: 'cancelled' });
      ctx.progress(i / scenes.length, `scene ${i + 1}/${scenes.length}`);
      const scene = scenes[i]!;
      const out = path.join(dir, `${scene.id}.png`);
      await this.renderCard(seq, scene, brief.language, out, ctx.signal);
      this.s.db.creator.updateScene(projectId, scene.id, { storyboardPath: out, status: scene.status === 'voiced' || scene.status === 'assembled' ? scene.status : 'storyboard' });
      rendered++;
    }
    ctx.progress(1, null);
    this.s.bus.emit('creator.updated', { projectId });
    return { rendered };
  }

  /** Renders one storyboard card: a coloured background with the scene heading and narration shaped by libass. */
  private async renderCard(seq: { width: number; height: number }, scene: CreatorScene, lang: 'ar' | 'en', out: string, signal: AbortSignal): Promise<void> {
    const ffmpeg = this.s.ffmpeg.ffmpeg;
    if (!ffmpeg) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'creator.storyboard', message: 'FFmpeg is required' });
    const hue = CARD_HUES[scene.index % CARD_HUES.length]!;
    const bg = hslHex(hue, 0.35, 0.16);
    const ass = path.join(path.dirname(out), `${scene.id}.ass`);
    fs.writeFileSync(ass, cardAss(seq.width, seq.height, scene.scene.heading, scene.scene.narration || scene.scene.action, lang), 'utf8');
    try {
      const res = await runFfmpeg({
        ffmpeg,
        args: ['-f', 'lavfi', '-i', `color=c=${bg}:s=${seq.width}x${seq.height}`, '-vf', `subtitles='${escapeFilterPath(ass)}',format=yuv420p`, '-frames:v', '1', out],
        signal,
        operation: 'creator.storyboard',
      });
      if (res.code !== 0 || !fs.existsSync(out)) throw new AppError({ code: 'FFMPEG_FAILED', operation: 'creator.storyboard', message: 'card render failed', details: { stderr: res.stderr.slice(-400) } });
    } finally {
      fs.rmSync(ass, { force: true });
    }
  }

  // -------------------------------------------------------------------------------------------------------- voice

  startVoice(projectId: string, sceneIds?: string[]): TaskInfo {
    this.requireScenes(projectId);
    const tts = this.s.capabilities.status('tts');
    if (tts.status !== 'available') throw new AppError({ code: tts.status === 'needs-runtime' ? 'WORKER_UNAVAILABLE' : 'MODEL_NOT_INSTALLED', operation: 'creator.voice', message: `Text-to-speech is not available (${tts.status})`, details: { capability: tts } });
    return this.s.tasks.enqueue({ kind: 'creator.voice', params: { projectId, sceneIds: sceneIds ?? [] }, projectId, priority: 4 });
  }

  private async synthVoice(p: { projectId: string; sceneIds: string[] }, ctx: Ctx): Promise<{ voiced: number; skipped: number }> {
    const { projectId } = p;
    const brief = this.requireBrief(projectId);
    const characters = this.s.db.creator.characters(projectId);
    const scenes = this.targetScenes(projectId, p.sceneIds);
    const dir = this.dataDir(projectId, 'voice');
    let voiced = 0;
    let skipped = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (ctx.signal.aborted) throw new AppError({ code: 'TASK_CANCELLED', operation: 'creator.voice', message: 'cancelled' });
      ctx.progress(i / scenes.length, `scene ${i + 1}/${scenes.length}`);
      const scene = scenes[i]!;
      const text = scene.scene.narration.trim() || scene.scene.dialogue.map((d) => d.line).join(' ').trim();
      if (!text) {
        skipped++;
        continue;
      }
      const voiceChar = characters.find((c) => scene.scene.characterIds.includes(c.id));
      const voice = voiceChar?.bible.voice.voice || (brief.language === 'ar' ? 'ar' : 'en');
      const rate = voiceChar?.bible.voice.rate ?? 165;
      const out = path.join(dir, `${scene.id}.wav`);
      const res = await this.s.worker.synthesize(text, out, { engine: 'espeak', voice, rate, signal: ctx.signal });
      this.s.db.creator.updateScene(projectId, scene.id, { voicePath: out, voiceMs: res.duration_ms, status: scene.status === 'assembled' ? 'assembled' : 'voiced' });
      voiced++;
    }
    ctx.progress(1, null);
    this.s.bus.emit('creator.updated', { projectId });
    return { voiced, skipped };
  }

  // ----------------------------------------------------------------------------------------------------- assembly

  startAssemble(projectId: string): TaskInfo {
    this.requireScenes(projectId);
    return this.s.tasks.enqueue({ kind: 'creator.assemble', params: { projectId }, projectId, priority: 3 });
  }

  private async assemble(p: { projectId: string }, ctx: Ctx): Promise<{ scenes: number; durationMs: number }> {
    const { projectId } = p;
    const brief = this.requireBrief(projectId);
    const seq = this.sequenceForBrief(brief);
    // ensure every scene has a storyboard card first
    ctx.progress(0.05, 'storyboard');
    await this.renderStoryboard({ projectId, sceneIds: [] }, { progress: () => undefined, signal: ctx.signal });
    const scenes = this.s.db.creator.scenes(projectId);
    if (scenes.length === 0) throw new AppError({ code: 'INVALID_INPUT', operation: 'creator.assemble', message: 'There are no scenes to assemble' });

    // import every card and voice asset, then wait for analysis
    ctx.progress(0.2, 'import');
    const files: string[] = [];
    for (const sc of scenes) {
      if (sc.storyboardPath) files.push(sc.storyboardPath);
      if (sc.voicePath) files.push(sc.voicePath);
    }
    const refs = await this.importAndWait(projectId, files, ctx.signal);

    // build a fresh document from the scenes
    ctx.progress(0.7, 'assemble');
    const row = this.s.projects.get(projectId);
    const doc = createDocument({ name: row.name, kind: 'creator', id: projectId, settings: seq });
    const video = doc.tracks.find((t) => t.kind === 'video')!;
    const audio = doc.tracks.find((t) => t.kind === 'audio')!;
    const subs = createSubtitleTrack({ language: brief.language, name: brief.language === 'ar' ? 'ترجمة' : 'Subtitles', source: 'creator' });
    let cursor = 0;
    for (const sc of scenes) {
      const displayMs = Math.max(1500, sc.scene.durationMs, sc.voiceMs ?? 0);
      const cardRef = sc.storyboardPath ? refs.get(sc.storyboardPath) : undefined;
      if (cardRef) {
        doc.assets[cardRef.id] = cardRef;
        video.clips.push(createClip({ trackId: video.id, asset: cardRef, startMs: cursor, imageDurationMs: displayMs }));
      }
      if (sc.voicePath) {
        const voiceRef = refs.get(sc.voicePath);
        if (voiceRef) {
          doc.assets[voiceRef.id] = voiceRef;
          audio.clips.push(createClip({ trackId: audio.id, asset: voiceRef, startMs: cursor }));
        }
      }
      const text = sc.scene.narration.trim() || sc.scene.dialogue.map((d) => d.line).join(' ').trim();
      if (text) subs.cues.push({ id: newId('cue'), startMs: cursor, endMs: cursor + displayMs, text, speaker: null });
      cursor += displayMs;
    }
    if (subs.cues.length) doc.subtitles.push(subs);

    // replace the open session's document (undoable) so all editor tools apply to the result
    const session = this.s.sessions.get(projectId);
    session.replaceDocument(doc, 'creator', { reason: 'creator', label: 'Assembled animatic' });
    for (const sc of scenes) this.s.db.creator.updateScene(projectId, sc.id, { status: 'assembled' });
    ctx.progress(1, null);
    this.s.bus.emit('creator.updated', { projectId });
    this.s.logger.info({ module: 'creator', operation: 'assemble', projectId, scenes: scenes.length, durationMs: cursor }, 'animatic assembled');
    return { scenes: scenes.length, durationMs: cursor };
  }

  private async importAndWait(projectId: string, files: string[], signal: AbortSignal) {
    const unique = [...new Set(files)];
    const map = new Map<string, ReturnType<MediaService['toAssetRef']>>();
    const result = this.s.media.import(unique, projectId);
    const byPath = new Map(result.assets.map((a) => [path.resolve(a.sourcePath), a.id]));
    for (const file of unique) {
      if (signal.aborted) throw new AppError({ code: 'TASK_CANCELLED', operation: 'creator.assemble', message: 'cancelled' });
      const id = byPath.get(path.resolve(file));
      if (!id) continue;
      const analyze = this.s.tasks.list({ includeFinished: true }).find((t) => t.kind === 'media.analyze' && t.params.assetId === id);
      if (analyze) await this.s.tasks.wait(analyze.id);
      const asset = this.s.media.get(id);
      if (asset && asset.analysisStatus === 'ready') map.set(file, this.s.media.toAssetRef(this.s.media.requireRow(id)));
    }
    return map;
  }

  // ------------------------------------------------------------------------------------------------------- review

  /** Deterministic QA plus character-consistency checks (SFace) when reference embeddings and faces exist. */
  async review(projectId: string): Promise<{ issues: CreatorQaIssue[]; mode: ProductionMode }> {
    const brief = this.requireBrief(projectId);
    const scenes = this.s.db.creator.scenes(projectId);
    const issues = reviewScript(brief, scenes.map((s) => ({ id: s.id, scene: s.scene, voiceMs: s.voiceMs, consistency: s.consistency, status: s.status })));
    const { mode } = this.productionMode();
    return { issues, mode };
  }

  clear(projectId: string): CreatorState {
    this.s.db.creator.clear(projectId);
    this.s.bus.emit('creator.updated', { projectId });
    return this.state(projectId);
  }

  // -------------------------------------------------------------------------------------------------------- utils

  private requireBrief(projectId: string): Brief {
    const { brief } = this.s.db.creator.getBriefScript(projectId);
    if (!brief) throw new AppError({ code: 'INVALID_INPUT', operation: 'creator', message: 'Set a brief first' });
    return brief;
  }

  private requireScenes(projectId: string): CreatorScene[] {
    const scenes = this.s.db.creator.scenes(projectId);
    if (scenes.length === 0) throw new AppError({ code: 'INVALID_INPUT', operation: 'creator', message: 'There are no scenes yet' });
    return scenes;
  }

  private targetScenes(projectId: string, sceneIds: string[]): CreatorScene[] {
    const all = this.s.db.creator.scenes(projectId);
    return sceneIds.length ? all.filter((s) => sceneIds.includes(s.id)) : all;
  }
}

// -------------------------------------------------------------------------------------------------------- helpers

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `0x${f(0)}${f(8)}${f(4)}`;
}

/** Builds a centered storyboard card as an ASS subtitle document (libass shapes Arabic correctly). */
function cardAss(width: number, height: number, heading: string, body: string, lang: 'ar' | 'en'): string {
  const headSize = Math.round(height * 0.05);
  const bodySize = Math.round(height * 0.06);
  const esc = (t: string) => t.replace(/\n/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')').trim();
  const dir = lang === 'ar' ? '\\q2' : '';
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Head,Noto Sans Arabic,${headSize},&H80D0D0FF,&H000000FF,&H64000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,60,60,${Math.round(height * 0.12)},1`,
    `Style: Body,Noto Sans Arabic,${bodySize},&H00FFFFFF,&H000000FF,&HA0000000,&H00000000,0,0,0,0,100,100,0,0,1,3,1,5,120,120,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,${formatAssTime(0)},${formatAssTime(3_600_000)},Head,,0,0,0,,${dir}${esc(heading)}`,
    `Dialogue: 0,${formatAssTime(0)},${formatAssTime(3_600_000)},Body,,0,0,0,,${dir}${esc(body)}`,
    '',
  ].join('\n');
}
