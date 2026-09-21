import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PythonRuntime } from './PythonRuntime';

/** Minimal stubs — detect() only needs the paths and never touches the task manager or logger. */
function makeRuntime(dirs: { userData: string; workerSourceDir: string }) {
  const paths = { venv: path.join(dirs.userData, 'python-venv'), resources: path.join(dirs.userData, 'resources') } as never;
  const tasks = { registerKind() {} } as never;
  const logger = { info() {}, warn() {}, error() {} } as never;
  const rt = new PythonRuntime(paths, tasks, logger);
  // Pin the worker source dir so the dev venv candidate is deterministic.
  (rt as unknown as { workerSourceDir: string }).workerSourceDir = dirs.workerSourceDir;
  return rt;
}

function touchVenvPython(venvDir: string): string {
  const py = process.platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
  fs.mkdirSync(path.dirname(py), { recursive: true });
  fs.writeFileSync(py, '');
  return py;
}

let tmp: string;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('PythonRuntime.detect', () => {
  it('prefers a ready interpreter over a half-built venv that shadows it', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pyrt-'));
    const userData = path.join(tmp, 'userData');
    const workerSourceDir = path.join(tmp, 'ai-worker');
    // Both the app venv and the dev venv exist on disk...
    const appPy = touchVenvPython(path.join(userData, 'python-venv'));
    const devPy = touchVenvPython(path.join(workerSourceDir, '.venv'));

    const rt = makeRuntime({ userData, workerSourceDir });
    // ...but only the dev venv actually has the worker installed (the app venv is a failed setup).
    (rt as unknown as { version: (p: string) => Promise<string | null> }).version = async (p) => (p === appPy || p === devPy ? '3.14.3' : null);
    (rt as unknown as { workerInstalled: (p: string) => Promise<boolean> }).workerInstalled = async (p) => p === devPy;

    const info = await rt.detect(true);
    expect(info?.path).toBe(devPy);
    expect(info?.source).toBe('dev-venv');
    expect(info?.workerInstalled).toBe(true);
  });

  it('falls back to the first viable interpreter when none has the worker yet (a base for setup)', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pyrt-'));
    const userData = path.join(tmp, 'userData');
    const workerSourceDir = path.join(tmp, 'ai-worker');
    const appPy = touchVenvPython(path.join(userData, 'python-venv'));

    const rt = makeRuntime({ userData, workerSourceDir });
    (rt as unknown as { version: (p: string) => Promise<string | null> }).version = async (p) => (p === appPy ? '3.14.3' : null);
    (rt as unknown as { workerInstalled: () => Promise<boolean> }).workerInstalled = async () => false;

    const info = await rt.detect(true);
    expect(info?.path).toBe(appPy);
    expect(info?.workerInstalled).toBe(false);
  });
});
