import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { AppPaths } from '../paths/AppPaths';
import type { TaskManager } from '../tasks/TaskManager';

const execFileAsync = promisify(execFile);

export interface PythonInfo {
  path: string;
  version: string;
  source: 'env' | 'venv' | 'dev-venv' | 'system';
  venvReady: boolean;
  workerInstalled: boolean;
}

function venvPython(dir: string): string {
  return process.platform === 'win32' ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python');
}

/** Packaged builds ship the worker in resources; development runs it from the repository checkout. */
function resolveWorkerDir(resources: string): string {
  const packaged = path.join(resources, 'ai-worker');
  if (fs.existsSync(path.join(packaged, 'pyproject.toml'))) return packaged;
  // development: walk up from the working directory to the repository checkout (works for tsx ESM, vitest and CJS bundles)
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'ai-worker', 'pyproject.toml');
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return packaged;
}

/**
 * Finds a usable Python and manages the app-owned virtual environment that hosts the AI worker.
 * Nothing is installed without an explicit setup task started by the user.
 */
export class PythonRuntime {
  private cached: PythonInfo | null = null;
  readonly workerSourceDir: string;

  constructor(private readonly paths: AppPaths, private readonly tasks: TaskManager, private readonly logger: Logger) {
    this.workerSourceDir = process.env.SEVENSTUDIOS_WORKER_DIR ?? resolveWorkerDir(paths.resources);
    tasks.registerKind<{ extras: string[] }, PythonInfo>({
      kind: 'runtime.setup',
      lane: 'io',
      title: () => 'Set up Python AI runtime',
      run: (ctx) => this.setup(ctx.params.extras, (r, m) => ctx.progress(r, m), ctx.signal),
    });
  }

  private async version(py: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(py, ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'], { timeout: 10_000 });
      const v = stdout.trim();
      const [major, minor] = v.split('.').map(Number);
      if ((major ?? 0) < 3 || ((major ?? 0) === 3 && (minor ?? 0) < 10)) return null;
      return v;
    } catch {
      return null;
    }
  }

  private async workerInstalled(py: string): Promise<boolean> {
    try {
      await execFileAsync(py, ['-c', 'import sevenstudios_worker, numpy'], { timeout: 15_000, env: { ...process.env, PYTHONPATH: fs.existsSync(this.workerSourceDir) ? this.workerSourceDir : '' } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detects the best Python: explicit env → app venv → repo dev venv → system interpreter.
   * An interpreter that actually has the worker installed always wins, so a half-built or
   * incompatible app venv (e.g. a failed `runtime.setup`) never shadows a working dev venv.
   * When none is ready, the first viable interpreter is returned as the base for a setup.
   */
  async detect(refresh = false): Promise<PythonInfo | null> {
    if (this.cached && !refresh) return this.cached;
    const candidates: Array<{ path: string; source: PythonInfo['source'] }> = [];
    if (process.env.SEVENSTUDIOS_PYTHON) candidates.push({ path: process.env.SEVENSTUDIOS_PYTHON, source: 'env' });
    candidates.push({ path: venvPython(this.paths.venv), source: 'venv' });
    const devVenv = path.join(this.workerSourceDir, '.venv');
    candidates.push({ path: venvPython(devVenv), source: 'dev-venv' });
    for (const name of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) candidates.push({ path: name, source: 'system' });
    let fallback: PythonInfo | null = null;
    for (const c of candidates) {
      if ((c.source === 'venv' || c.source === 'dev-venv' || c.source === 'env') && !fs.existsSync(c.path)) continue;
      const version = await this.version(c.path);
      if (!version) continue;
      const installed = await this.workerInstalled(c.path);
      const info: PythonInfo = { path: c.path, version, source: c.source, venvReady: c.source !== 'system' && installed, workerInstalled: installed };
      if (installed) {
        this.cached = info;
        return info;
      }
      // Keep the first viable-but-not-ready interpreter (venv/dev-venv preferred over system by order) as a fallback base for setup.
      fallback ??= info;
    }
    this.cached = fallback;
    return fallback;
  }

  private pipInstall(py: string, spec: string, signal?: AbortSignal): Promise<unknown> {
    return execFileAsync(py, ['-m', 'pip', 'install', spec], { timeout: 3_600_000, signal, maxBuffer: 50_000_000 });
  }

  /**
   * Creates the venv and installs the worker with the requested extras (a real, user-initiated task).
   * If installing all extras at once fails — commonly because one extra has no wheel for the running
   * Python version (e.g. `upscale`/`realesrgan-ncnn-py` on Python 3.13+) — it falls back to installing
   * the base worker plus each extra individually, skipping only the incompatible ones so the rest still
   * work. It fails only when the worker itself could not be installed.
   */
  async setup(extras: string[], progress: (ratio: number, message?: string) => void, signal?: AbortSignal): Promise<PythonInfo> {
    const base = (await this.detect(true))?.path ?? (process.platform === 'win32' ? 'python' : 'python3');
    const venv = this.paths.venv;
    const py = venvPython(venv);
    if (!fs.existsSync(py)) {
      progress(0.05, 'create venv');
      await execFileAsync(base, ['-m', 'venv', venv], { timeout: 180_000, signal });
    }
    progress(0.15, 'pip');
    await execFileAsync(py, ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel'], { timeout: 600_000, signal, maxBuffer: 10_000_000 });
    if (!fs.existsSync(this.workerSourceDir)) throw new AppError({ code: 'WORKER_UNAVAILABLE', operation: 'runtime.setup', message: `Worker sources not found at ${this.workerSourceDir}` });

    progress(0.3, `install ${extras.join(', ') || 'worker'}`);
    const skipped: string[] = [];
    try {
      // Fast path: resolve and install everything together.
      await this.pipInstall(py, extras.length ? `${this.workerSourceDir}[${extras.join(',')}]` : this.workerSourceDir, signal);
    } catch (allErr) {
      if (signal?.aborted) throw allErr;
      // One or more extras cannot be satisfied on this Python. Install the base worker, then each extra on
      // its own, keeping the ones that succeed and skipping the rest — never let one failure sink all of it.
      this.logger.warn({ operation: 'runtime.setup', err: String((allErr as Error)?.message ?? allErr) }, 'combined extras install failed; retrying per-extra');
      await this.pipInstall(py, this.workerSourceDir, signal);
      for (let i = 0; i < extras.length; i++) {
        const extra = extras[i]!;
        progress(0.3 + (0.6 * (i + 1)) / (extras.length + 1), `install ${extra}`);
        try {
          await this.pipInstall(py, `${this.workerSourceDir}[${extra}]`, signal);
        } catch (extraErr) {
          if (signal?.aborted) throw extraErr;
          skipped.push(extra);
          this.logger.warn({ operation: 'runtime.setup', extra, err: String((extraErr as Error)?.message ?? extraErr) }, 'skipped incompatible extra');
        }
      }
    }

    progress(0.95, 'verify');
    const info = await this.detect(true);
    if (!info?.workerInstalled) throw new AppError({ code: 'WORKER_UNAVAILABLE', operation: 'runtime.setup', message: 'Worker installation did not complete', details: { skipped } });
    this.logger.info({ operation: 'runtime.setup', python: info.path, version: info.version, installed: extras.filter((e) => !skipped.includes(e)), skipped }, skipped.length ? 'python runtime ready (some extras skipped)' : 'python runtime ready');
    return info;
  }

  startSetupTask(extras: string[]) {
    return this.tasks.enqueue({ kind: 'runtime.setup', params: { extras }, priority: 5 });
  }
}
