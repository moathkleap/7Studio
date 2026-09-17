import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { frameDurationMs, getExportPreset, type ProjectDocument } from '@sevenvid/core';
import { runFfmpeg } from '../ffmpeg/runner';
import { compileRenderGraph } from './RenderGraphCompiler';
import type { FfmpegLocation } from '../ffmpeg/locator';
import type { TaskInfo } from '@sevenvid/ipc';
import { AppError } from '../errors';
import type { ExportService } from '../export/ExportService';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { ProjectService } from '../project/ProjectService';
import type { SessionManager } from '../project/SessionManager';
import type { TaskManager } from '../tasks/TaskManager';

export interface PreviewRenderResult {
  path: string;
  startMs: number;
  endMs: number;
  hash: string;
}

/** Renders a timeline range at proxy quality into the project cache (used for effects the live preview cannot show). */
export class PreviewRenderService {
  constructor(
    private readonly paths: AppPaths,
    private readonly ffmpeg: FfmpegLocation,
    private readonly tasks: TaskManager,
    private readonly projects: ProjectService,
    private readonly sessions: SessionManager,
    private readonly exports: ExportService,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ projectId: string; startMs: number; endMs: number }, PreviewRenderResult>({
      kind: 'render.preview',
      lane: 'render',
      title: () => 'Render preview',
      run: async (ctx) => this.run(ctx.params, ctx),
    });
    tasks.registerKind<{ projectId: string; tMs: number }, { path: string }>({
      kind: 'render.frame',
      lane: 'render',
      title: () => 'Extract frame',
      run: async (ctx) => this.extractFrame(ctx.params.projectId, ctx.params.tMs, ctx.signal),
    });
  }

  extractFrameTask(projectId: string, tMs: number): TaskInfo {
    this.projects.get(projectId);
    return this.tasks.enqueue({ kind: 'render.frame', params: { projectId, tMs }, projectId, priority: 4 });
  }

  /** Renders the fully composited frame at `tMs` (all tracks, transforms, effects) to a PNG in the exports folder. */
  async extractFrame(projectId: string, tMs: number, signal?: AbortSignal): Promise<{ path: string }> {
    if (!this.ffmpeg.ffmpeg) throw new AppError({ code: 'FFMPEG_NOT_FOUND', operation: 'render.frame', message: 'FFmpeg is required' });
    const doc: ProjectDocument = this.sessions.isOpen(projectId) ? this.sessions.get(projectId).document : this.projects.loadLatestDocument(projectId);
    const project = this.projects.get(projectId);
    const frame = frameDurationMs(doc.settings.fps);
    const target = { width: doc.settings.width, height: doc.settings.height, fps: doc.settings.fps, sampleRate: doc.settings.sampleRate, channels: doc.settings.channels };
    const graph = compileRenderGraph({ doc, target, range: { startMs: Math.max(0, tMs), endMs: Math.max(0, tMs) + Math.max(frame * 2, 100) } });
    const scratch = path.join(project.dataDir, 'cache', 'render');
    fs.mkdirSync(scratch, { recursive: true });
    const script = path.join(scratch, `frame-${Date.now()}.txt`);
    fs.writeFileSync(script, graph.filterScript, 'utf8');
    const dir = this.paths.exports;
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${project.name.replace(/[\\/:*?"<>|]+/g, '-')}-frame-${Math.round(tMs)}ms.png`);
    const args: string[] = [];
    for (const input of graph.inputs) args.push(...input.args, '-i', input.path);
    args.push('-filter_complex_script', script, '-map', graph.videoLabel, '-frames:v', '1', '-update', '1', '-f', 'image2', out);
    try {
      await runFfmpeg({ ffmpeg: this.ffmpeg.ffmpeg, args, signal, operation: 'render.frame', logger: this.logger });
    } finally {
      fs.rmSync(script, { force: true });
    }
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new AppError({ code: 'RENDER_FAILED', operation: 'render.frame', message: 'Frame file was not produced' });
    return { path: out };
  }

  renderRange(projectId: string, startMs: number, endMs: number): TaskInfo {
    if (!(endMs > startMs)) throw new AppError({ code: 'INVALID_INPUT', operation: 'render.previewRange', message: 'Invalid range' });
    this.projects.get(projectId);
    return this.tasks.enqueue({ kind: 'render.preview', params: { projectId, startMs, endMs }, projectId, priority: 3 });
  }

  private async run(p: { projectId: string; startMs: number; endMs: number }, ctx: { progress: (v: number, m?: string | null) => void; signal: AbortSignal }): Promise<PreviewRenderResult> {
    const doc: ProjectDocument = this.sessions.isOpen(p.projectId) ? this.sessions.get(p.projectId).document : this.projects.loadLatestDocument(p.projectId);
    const project = this.projects.get(p.projectId);
    const hash = crypto.createHash('sha1').update(JSON.stringify({ tracks: doc.tracks, masks: doc.masks, subtitles: doc.subtitles, master: doc.master, settings: doc.settings, range: [p.startMs, p.endMs] })).digest('hex').slice(0, 16);
    const dir = path.join(project.dataDir, 'cache', 'preview');
    const out = path.join(dir, `${hash}.mp4`);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return { path: out, startMs: p.startMs, endMs: p.endMs, hash };
    fs.mkdirSync(dir, { recursive: true });
    const preset = getExportPreset('web-small').settings;
    const pathOverrides: Record<string, string> = {};
    for (const a of Object.values(doc.assets)) if (a.proxyPath && fs.existsSync(a.proxyPath)) pathOverrides[a.id] = a.proxyPath;
    await this.exports.render(doc, out, { ...preset, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: null, height: null, fps: null, burnSubtitles: true }, { range: { startMs: p.startMs, endMs: p.endMs }, usePreviewQuality: true, pathOverrides, signal: ctx.signal, scratchDir: path.join(project.dataDir, 'cache', 'render'), onProgress: (r, m) => ctx.progress(r, m) });
    this.logger.info({ operation: 'preview', projectId: p.projectId, hash, ms: p.endMs - p.startMs }, 'preview rendered');
    return { path: out, startMs: p.startMs, endMs: p.endMs, hash };
  }
}
