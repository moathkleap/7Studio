import fs from 'node:fs';
import path from 'node:path';
import {
  composeCaption,
  describeSoundUsage,
  fpsToNumber,
  getDocumentDurationMs,
  getExportPreset,
  getPublishTarget,
  newId,
  normalizeHashtags,
  planPublishFit,
  PUBLISH_TARGETS,
  type ExportSettings,
  type ProjectDocument,
  type PublishFit,
  type PublishTarget,
  type ReframeStrategy,
  type TrendSound,
} from '@sevenstudios/core';
import { AppError } from '../errors';
import type { EventBus } from '../events/EventBus';
import type { FfmpegLocation } from '../ffmpeg/locator';
import { runFfmpeg } from '../ffmpeg/runner';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { SettingsService } from '../settings/SettingsService';
import type { TaskManager } from '../tasks/TaskManager';
import type { ExportService } from '../export/ExportService';
import { validateRenderedFile } from '../export/validate';

export interface PublishTargetInfo extends PublishTarget {
  fit: PublishFit | null;
}

export interface PublishBuildRequest {
  projectId: string;
  targetId: string;
  strategy?: ReframeStrategy;
  caption?: string;
  hashtags?: string;
  /** A trending sound to suggest for upload; never embedded in the exported video. */
  sound?: TrendSound | null;
  /** Mix level (dB) for an embedded cleared music bed, relative to the timeline audio. Default -6. */
  musicGainDb?: number;
  outputDir?: string | null;
}

export interface PublishPackage {
  id: string;
  projectId: string;
  targetId: string;
  taskId: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  dir: string;
  videoPath: string;
  thumbnailPath: string | null;
  captionPath: string | null;
  width: number;
  height: number;
  durationMs: number;
  strategy: ReframeStrategy;
  trimmed: boolean;
  warnings: string[];
  validation: Record<string, unknown> | null;
  suggestedSound: TrendSound | null;
  error: string | null;
  createdAt: string;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'publish';
}

/** Final linear filter chain that reframes the (sequence-sized) composition onto the target canvas. */
function reframeFilters(strategy: ReframeStrategy, w: number, h: number): string[] {
  if (strategy === 'fit') {
    return [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1'];
  }
  // 'crop' (fill). 'blur-fill' is not expressible as a linear final filter yet, so it falls back to crop.
  return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`, 'setsar=1'];
}

/**
 * Turns a finished project into a platform-ready package: the video reframed and resized to a platform's
 * exact canvas, trimmed to its duration limit, plus a thumbnail and a caption/hashtags file — everything
 * needed to upload, validated by measurement. It does not post anything; nothing leaves the machine.
 */
export class PublishService {
  private readonly records = new Map<string, PublishPackage>();

  constructor(
    private readonly paths: AppPaths,
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly settings: SettingsService,
    private readonly exports: ExportService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ packageId: string; req: PublishBuildRequest }, PublishPackage>({
      kind: 'render.publish',
      lane: 'render',
      pausable: true,
      title: (p) => `Publish ${p.req.targetId}`,
      run: (ctx) => this.runBuild(ctx.params.packageId, ctx.params.req, ctx),
    });
  }

  private loadDocument(projectId: string): ProjectDocument {
    return this.sessions.isOpen(projectId) ? this.sessions.get(projectId).document : this.projects.loadLatestDocument(projectId);
  }

  /** Lists every target, with how the given project fits it (aspect, upscale, over-length) when provided. */
  targets(projectId?: string | null): PublishTargetInfo[] {
    let source: { width: number; height: number; durationMs: number } | null = null;
    if (projectId) {
      try {
        const doc = this.loadDocument(projectId);
        source = { width: doc.settings.width, height: doc.settings.height, durationMs: getDocumentDurationMs(doc) };
      } catch {
        source = null;
      }
    }
    return PUBLISH_TARGETS.map((t) => ({ ...t, fit: source ? planPublishFit(source, t) : null }));
  }

  get(id: string): PublishPackage | undefined {
    return this.records.get(id);
  }

  recent(limit = 50): PublishPackage[] {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  /** Creates a package record and queues the build task. */
  build(req: PublishBuildRequest): PublishPackage {
    if (!this.ffmpeg.ffmpeg || !this.ffmpeg.ffprobe) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'publish.build', message: 'FFmpeg is required to build a package' });
    const target = getPublishTarget(req.targetId);
    if (!target) throw new AppError({ code: 'INVALID_INPUT', operation: 'publish.build', message: `Unknown publish target ${req.targetId}` });
    const project = this.projects.get(req.projectId);
    const doc = this.loadDocument(req.projectId);
    if (doc.tracks.every((t) => t.clips.length === 0)) throw new AppError({ code: 'VALIDATION_FAILED', operation: 'publish.build', message: 'The timeline is empty; nothing to publish' });
    const baseDir = req.outputDir ?? path.join(this.settings.get().storage.exportsDir ?? this.paths.exports, 'publish');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const dir = path.join(baseDir, `${safeName(project.name)}-${target.id}-${stamp}`);
    const strategy = req.strategy ?? target.defaultStrategy;
    const record: PublishPackage = {
      id: newId('pub'),
      projectId: req.projectId,
      targetId: target.id,
      taskId: null,
      status: 'queued',
      dir,
      videoPath: path.join(dir, `${safeName(project.name)}.${target.container}`),
      thumbnailPath: null,
      captionPath: null,
      width: target.width,
      height: target.height,
      durationMs: 0,
      strategy,
      trimmed: false,
      warnings: [],
      validation: null,
      suggestedSound: req.sound ?? null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    const task = this.tasks.enqueue({ kind: 'render.publish', params: { packageId: record.id, req: { ...req, strategy } }, projectId: req.projectId, priority: 1 });
    record.taskId = task.id;
    this.bus.emit('publish.changed', { packageId: record.id, status: 'queued' });
    return record;
  }

  private async runBuild(packageId: string, req: PublishBuildRequest, ctx: { progress: (v: number, m?: string | null) => void; signal: AbortSignal; setPauseHandlers: (h: { pause: () => void; resume: () => void } | null) => void }): Promise<PublishPackage> {
    const record = this.records.get(packageId)!;
    const target = getPublishTarget(req.targetId)!;
    const doc = this.loadDocument(req.projectId);
    const project = this.projects.get(req.projectId);
    record.status = 'running';
    this.bus.emit('publish.changed', { packageId, status: 'running' });
    fs.mkdirSync(record.dir, { recursive: true });

    const fullDuration = getDocumentDurationMs(doc);
    const fit = planPublishFit({ width: doc.settings.width, height: doc.settings.height, durationMs: fullDuration }, target);
    const range = fit.willTrim ? { startMs: 0, endMs: target.maxDurationMs! } : null;
    record.trimmed = fit.willTrim;
    const warnings: string[] = [];
    if (fit.willTrim) warnings.push(`trimmed to the ${Math.round(target.maxDurationMs! / 1000)}s limit for ${target.id}`);
    if (fit.upscales) warnings.push('the source is smaller than the target canvas and was upscaled');
    if (req.strategy === 'blur-fill') warnings.push('blur-fill is not available yet; used crop instead');
    // A copyrighted platform sound is never embedded; it is added from within the platform at upload time.
    if (req.sound && !req.sound.licensed) warnings.push(`suggested sound "${req.sound.name}" is copyrighted and not embedded; add it from within the platform when you upload`);
    // A cleared (licensed) sound backed by a local file is mixed in as a background bed; a URL-only one cannot be.
    const soundUrl = req.sound?.licensed ? req.sound.url : null;
    const embedMusicPath = soundUrl && !/^https?:/i.test(soundUrl) && fs.existsSync(soundUrl) ? soundUrl : null;
    if (req.sound?.licensed && !embedMusicPath) warnings.push(`cleared sound "${req.sound.name}" has no local file and was not embedded; it is kept as a note`);
    if (embedMusicPath) warnings.push(`embedded cleared sound "${req.sound!.name}" as a background music bed`);

    const seqFps = fpsToNumber(doc.settings.fps);
    const cappedFps = target.maxFps != null && seqFps > target.maxFps ? { num: Math.round(target.maxFps * 1000), den: 1000 } : null;
    const settings: ExportSettings = {
      ...getExportPreset('high-quality').settings,
      presetId: 'custom',
      container: target.container,
      videoCodec: target.container === 'webm' ? 'vp9' : 'h264',
      audioCodec: target.container === 'webm' ? 'opus' : 'aac',
      width: null,
      height: null,
      fps: cappedFps,
      qualityMode: 'crf',
      crf: 20,
      speedPreset: 'medium',
      burnSubtitles: false,
    };

    try {
      const rendered = await this.exports.render(doc, record.videoPath, settings, {
        range,
        signal: ctx.signal,
        scratchDir: path.join(project.dataDir, 'cache', 'publish'),
        finalVideoFilters: reframeFilters(record.strategy, target.width, target.height),
        backgroundMusic: embedMusicPath ? { path: embedMusicPath, gainDb: req.musicGainDb ?? -6 } : null,
        onProgress: (ratio, message) => ctx.progress(Math.min(0.9, ratio * 0.9), message),
        onProcess: (_proc, controls) => ctx.setPauseHandlers({ pause: () => void controls.pause(), resume: () => void controls.resume() }),
      });
      ctx.setPauseHandlers(null);
      record.durationMs = rendered.durationMs;
      warnings.push(...rendered.warnings);

      // Thumbnail from a frame ~1s in (or the midpoint of a very short clip).
      ctx.progress(0.92, 'thumbnail');
      const thumbAt = Math.min(1000, Math.max(0, rendered.durationMs / 2)) / 1000;
      const thumbPath = path.join(record.dir, 'thumbnail.png');
      try {
        await runFfmpeg({ ffmpeg: this.ffmpeg.ffmpeg!, args: ['-ss', thumbAt.toFixed(3), '-i', record.videoPath, '-frames:v', '1', '-q:v', '2', thumbPath], logger: this.logger, operation: 'publish.thumbnail' });
        if (fs.existsSync(thumbPath)) record.thumbnailPath = thumbPath;
      } catch (err) {
        this.logger.warn({ module: 'publish', err }, 'thumbnail extraction failed');
      }

      // Caption + hashtags + metadata.
      ctx.progress(0.95, 'metadata');
      const hashtags = normalizeHashtags(req.hashtags ?? '', target.hashtagMax);
      const caption = composeCaption((req.caption ?? '').slice(0, target.captionMax), hashtags);
      record.captionPath = path.join(record.dir, 'caption.txt');
      fs.writeFileSync(record.captionPath, caption, 'utf8');
      // A suggested sound is advisory only: write a human-readable note so the uploader knows how to use it.
      if (req.sound) {
        const note = [describeSoundUsage(req.sound), req.sound.url ? `Sound: ${req.sound.url}` : null].filter(Boolean).join('\n');
        fs.writeFileSync(path.join(record.dir, 'sound.txt'), note, 'utf8');
      }
      fs.writeFileSync(
        path.join(record.dir, 'metadata.json'),
        JSON.stringify({ platform: target.platform, target: target.id, width: target.width, height: target.height, container: target.container, durationMs: rendered.durationMs, strategy: record.strategy, trimmed: record.trimmed, caption, hashtags, suggestedSound: req.sound ?? null, embeddedSound: Boolean(embedMusicPath), project: project.name, createdAt: record.createdAt }, null, 2),
        'utf8',
      );

      // Validate the produced video by measurement.
      ctx.progress(0.98, 'validating');
      const validation = await validateRenderedFile(this.ffmpeg.ffmpeg!, this.ffmpeg.ffprobe!, record.videoPath, { durationMs: rendered.durationMs, width: target.width, height: target.height }, { signal: ctx.signal, decode: this.settings.get().export.validateAfterExport });
      record.validation = validation as unknown as Record<string, unknown>;
      record.warnings = warnings;
      if (!validation.ok) {
        const failed = validation.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ');
        throw new AppError({ code: 'EXPORT_VALIDATION_FAILED', operation: 'publish.build', message: `Package failed validation: ${failed}`, details: { packageId, validation } });
      }
      record.status = 'done';
      ctx.progress(1, null);
      this.bus.emit('publish.changed', { packageId, status: 'done' });
      this.logger.info({ module: 'publish', operation: 'build', packageId, target: target.id, dir: record.dir, durationMs: rendered.durationMs }, 'package built');
      return record;
    } catch (err) {
      const appErr = AppError.from(err, { code: 'RENDER_FAILED', operation: 'publish.build', details: { packageId } });
      const cancelled = ctx.signal.aborted || appErr.info.code === 'TASK_CANCELLED';
      record.status = 'failed';
      record.error = cancelled ? null : appErr.info.message;
      record.warnings = warnings;
      this.bus.emit('publish.changed', { packageId, status: 'failed' });
      throw appErr;
    }
  }
}
