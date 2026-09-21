import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { legacyUserDataDir, migrateLegacyUserData } from './migrateLegacy';

const dirs: string[] = [];

function scratch(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sevenstudios-migrate-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Builds a realistic legacy ~/.sevenvid tree with app-named db and log files. */
function seedLegacy(root: string): string {
  const legacy = path.join(root, '.sevenvid');
  fs.mkdirSync(path.join(legacy, 'projects', 'p1'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'sevenvid.db'), 'DB');
  fs.writeFileSync(path.join(legacy, 'sevenvid.db-wal'), 'WAL');
  fs.writeFileSync(path.join(legacy, 'sevenvid.db-shm'), 'SHM');
  fs.writeFileSync(path.join(legacy, 'projects', 'p1', 'project.json'), '{}');
  fs.writeFileSync(path.join(legacy, 'logs', 'sevenvid.log'), 'log0');
  fs.writeFileSync(path.join(legacy, 'logs', 'sevenvid.log.1'), 'log1');
  return legacy;
}

describe('migrateLegacyUserData', () => {
  it('moves the legacy tree and renames app-named db and log files', () => {
    const root = scratch();
    const legacy = seedLegacy(root);
    const target = path.join(root, '.sevenstudios');

    const res = migrateLegacyUserData(target, { legacyDir: legacy });

    expect(res.migrated).toBe(true);
    expect(res.from).toBe(path.resolve(legacy));
    expect(res.to).toBe(path.resolve(target));

    // Legacy directory is gone (moved), contents preserved under the new path.
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(target, 'projects', 'p1', 'project.json'), 'utf8')).toBe('{}');

    // App-named files renamed, old names gone, contents intact.
    expect(fs.readFileSync(path.join(target, 'sevenstudios.db'), 'utf8')).toBe('DB');
    expect(fs.readFileSync(path.join(target, 'sevenstudios.db-wal'), 'utf8')).toBe('WAL');
    expect(fs.readFileSync(path.join(target, 'sevenstudios.db-shm'), 'utf8')).toBe('SHM');
    expect(fs.existsSync(path.join(target, 'sevenvid.db'))).toBe(false);
    expect(fs.readFileSync(path.join(target, 'logs', 'sevenstudios.log'), 'utf8')).toBe('log0');
    expect(fs.readFileSync(path.join(target, 'logs', 'sevenstudios.log.1'), 'utf8')).toBe('log1');
    expect(fs.existsSync(path.join(target, 'logs', 'sevenvid.log'))).toBe(false);
  });

  it('does nothing when the new directory already exists', () => {
    const root = scratch();
    const legacy = seedLegacy(root);
    const target = path.join(root, '.sevenstudios');
    fs.mkdirSync(target, { recursive: true });

    const res = migrateLegacyUserData(target, { legacyDir: legacy });

    expect(res.migrated).toBe(false);
    expect(res.note).toBe('target-exists');
    // Legacy tree is left untouched.
    expect(fs.existsSync(path.join(legacy, 'sevenvid.db'))).toBe(true);
  });

  it('does nothing when there is no legacy directory', () => {
    const root = scratch();
    const target = path.join(root, '.sevenstudios');

    const res = migrateLegacyUserData(target, { legacyDir: path.join(root, '.sevenvid') });

    expect(res.migrated).toBe(false);
    expect(res.note).toBe('no-legacy');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('derives the legacy sibling dir from the new dir name (Electron and default layouts)', () => {
    expect(legacyUserDataDir('/home/u/.sevenstudios')).toBe(path.resolve('/home/u/.sevenvid'));
    expect(legacyUserDataDir('/AppData/Roaming/7Studio')).toBe(path.resolve('/AppData/Roaming/7vid'));
    // Custom / isolated paths (tests, browser dev tree) have no mapping.
    expect(legacyUserDataDir('/tmp/sevenstudios-test-abc')).toBeNull();
    expect(legacyUserDataDir('/repo/.sevenstudios-dev/userData')).toBeNull();
  });

  it('migrates an Electron-style <appData>/7Studio dir from its 7vid sibling without an explicit legacyDir', () => {
    const root = scratch();
    const legacy = path.join(root, '7vid');
    fs.mkdirSync(path.join(legacy, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'sevenvid.db'), 'DB');
    fs.writeFileSync(path.join(legacy, 'logs', 'sevenvid.log'), 'log0');
    const target = path.join(root, '7Studio');

    const res = migrateLegacyUserData(target); // no legacyDir → derived from basename

    expect(res.migrated).toBe(true);
    expect(res.from).toBe(path.resolve(legacy));
    expect(fs.readFileSync(path.join(target, 'sevenstudios.db'), 'utf8')).toBe('DB');
    expect(fs.readFileSync(path.join(target, 'logs', 'sevenstudios.log'), 'utf8')).toBe('log0');
  });

  it('does nothing for an unmapped (custom) userData name', () => {
    const root = scratch();
    fs.mkdirSync(path.join(root, '.sevenvid'), { recursive: true });
    const res = migrateLegacyUserData(path.join(root, 'custom-data'));
    expect(res.migrated).toBe(false);
    expect(res.note).toBe('no-legacy-mapping');
  });

  it('is idempotent across two calls', () => {
    const root = scratch();
    const legacy = seedLegacy(root);
    const target = path.join(root, '.sevenstudios');

    expect(migrateLegacyUserData(target, { legacyDir: legacy }).migrated).toBe(true);
    const second = migrateLegacyUserData(target, { legacyDir: legacy });
    expect(second.migrated).toBe(false);
    expect(second.note).toBe('target-exists');
    expect(fs.readFileSync(path.join(target, 'sevenstudios.db'), 'utf8')).toBe('DB');
  });
});
