import fs from 'node:fs';
import path from 'node:path';
import { newId, type MusicTrack } from '@sevenstudios/core';
import type { CapabilityRegistry } from '../capabilities/CapabilityRegistry';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { TaskManager } from '../tasks/TaskManager';
import type { WorkerService } from '../worker/WorkerService';

export interface MusicGenRequest {
  prompt?: string;
  mood?: string | null;
  tags?: string[];
  durationMs?: number;
  name?: string;
  modelId?: string;
}

/**
 * Generates a cleared music track locally through the Python worker (MusicGen) and adds it to the user's
 * music library, so it can be embedded honestly. Gated on the `gen.music` capability: when the worker or a
 * model is missing it fails with the reason rather than faking a result.
 */
export class MusicGenService {
  constructor(
    private readonly paths: AppPaths,
    private readonly tasks: TaskManager,
    private readonly worker: WorkerService,
    private readonly capabilities: CapabilityRegistry,
    private readonly logger: Logger,
  ) {
    tasks.registerKind<{ req: MusicGenRequest }, MusicTrack>({
      kind: 'gen.music',
      lane: 'ai',
      cancellable: true,
      title: () => 'Generate music',
      run: (ctx) => this.runGenerate(ctx.params.req, ctx),
    });
  }

  /** Generates a track and returns it once written to the library, or throws when generation is unavailable. */
  async generate(req: MusicGenRequest): Promise<MusicTrack> {
    if (!this.capabilities.isAvailable('gen.music')) {
      const info = this.capabilities.status('gen.music');
      throw new AppError({ code: 'WORKER_UNAVAILABLE', operation: 'music.generate', message: `Local music generation is not available (${info.status})`, details: { capability: info } });
    }
    return this.tasks.run<{ req: MusicGenRequest }, MusicTrack>({ kind: 'gen.music', params: { req }, priority: 1 });
  }

  private async runGenerate(req: MusicGenRequest, ctx: { progress: (v: number, m?: string | null) => void; signal: AbortSignal }): Promise<MusicTrack> {
    const prompt = (req.prompt ?? '').trim() || [req.mood, ...(req.tags ?? [])].filter(Boolean).join(', ');
    if (!prompt) throw new AppError({ code: 'INVALID_INPUT', operation: 'music.generate', message: 'A prompt, mood or tags are required to generate music' });
    const id = newId('music');
    const dir = path.join(this.paths.userData, 'music');
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, `${id}.wav`);
    ctx.progress(0.05, 'generating');
    const res = await this.worker.generateMusic(prompt, outPath, { durationMs: req.durationMs ?? 15000, modelId: req.modelId, signal: ctx.signal, onProgress: (r, m) => ctx.progress(0.05 + r * 0.9, m) });
    const name = (req.name ?? '').trim() || prompt.slice(0, 40);
    const track: MusicTrack = { id, name, file: res.out_path, tags: req.tags ?? [], mood: req.mood ?? null, durationMs: Math.round(res.duration_ms), licensed: true, source: 'generated' };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, name, file: `${id}.wav`, tags: track.tags, mood: track.mood, durationMs: track.durationMs, source: 'generated' }, null, 2), 'utf8');
    ctx.progress(1, null);
    this.logger.info({ module: 'music', operation: 'generate', id, durationMs: track.durationMs }, 'music generated');
    return track;
  }
}
