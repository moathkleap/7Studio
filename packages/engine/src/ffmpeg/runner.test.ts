import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runFfmpeg } from './runner';

/** Writes a fake `ffmpeg` executable (POSIX shell) that prints the given stderr and exits with the given code. */
function fakeFfmpeg(dir: string, stderr: string, code: number): string {
  const file = path.join(dir, 'fake-ffmpeg.sh');
  fs.writeFileSync(file, `#!/bin/sh\ncat 1>/dev/null 2>&1 || true\nprintf '%s\\n' ${JSON.stringify(stderr)} 1>&2\nexit ${code}\n`, { mode: 0o755 });
  return file;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('runFfmpeg error classification', () => {
  it('maps an out-of-space failure to DISK_FULL', async () => {
    const ff = fakeFfmpeg(dir, 'Output file #0 does not contain any stream\nav_interleaved_write_frame(): No space left on device', 1);
    await expect(runFfmpeg({ ffmpeg: ff, args: ['-i', 'in.mp4', 'out.mp4'], operation: 'test' })).rejects.toMatchObject({ info: { code: 'DISK_FULL' } });
  });

  it('maps a generic non-zero exit to FFMPEG_FAILED', async () => {
    const ff = fakeFfmpeg(dir, 'Invalid argument\nError opening filters', 1);
    await expect(runFfmpeg({ ffmpeg: ff, args: ['-i', 'in.mp4', 'out.mp4'], operation: 'test' })).rejects.toMatchObject({ info: { code: 'FFMPEG_FAILED' } });
  });

  it('resolves on a clean exit', async () => {
    const ff = fakeFfmpeg(dir, '', 0);
    const r = await runFfmpeg({ ffmpeg: ff, args: ['-i', 'in.mp4', 'out.mp4'], operation: 'test' });
    expect(r.code).toBe(0);
  });
});
