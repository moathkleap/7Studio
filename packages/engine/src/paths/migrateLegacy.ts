import fs from 'node:fs';
import path from 'node:path';

/**
 * One-time migration of the pre-rename user-data directory.
 *
 * Before the app was renamed to 7Studio it stored everything under a
 * `7vid`/`.sevenvid` directory with an app-named database (`sevenvid.db`) and
 * log files (`sevenvid.log*`). New builds read the renamed directory and
 * `sevenstudios.db`, so an existing install would otherwise start with an empty
 * tree. This moves the old directory to the new location on first launch and
 * renames the app-named files inside it, preserving projects, settings, models
 * and logs.
 *
 * The old directory is derived from the new one's name, so both real locations
 * are covered: the Electron `userData` dir (`<appData>/7vid` → `<appData>/7Studio`,
 * from the old productName) and the non-Electron default (`~/.sevenvid` →
 * `~/.sevenstudios`). A custom or isolated userData path (env override, tests,
 * the browser dev tree) has an unmapped name and is skipped.
 */

/** New directory basename → the legacy basename it replaced. */
const LEGACY_BASENAMES: Record<string, string> = {
  '.sevenstudios': '.sevenvid',
  '7Studio': '7vid',
};

const LEGACY_DB = 'sevenvid.db';
const NEW_DB = 'sevenstudios.db';
const LEGACY_LOG = 'sevenvid.log';
const NEW_LOG = 'sevenstudios.log';

export interface LegacyMigration {
  migrated: boolean;
  from: string | null;
  to: string | null;
  /** Why nothing was migrated, or a non-fatal note. */
  note?: string;
}

export interface MigrateLegacyOptions {
  /** Override the legacy directory. Mainly for tests; production derives it from the new dir's name. */
  legacyDir?: string;
}

/** Resolves the pre-rename sibling directory for a new userData path, or null when the name is unmapped. */
export function legacyUserDataDir(newUserData: string): string | null {
  const target = path.resolve(newUserData);
  const legacyBase = LEGACY_BASENAMES[path.basename(target)];
  return legacyBase ? path.join(path.dirname(target), legacyBase) : null;
}

/**
 * Moves the legacy tree to `newUserData` when the new location does not yet
 * exist. Idempotent: once the new directory is present nothing happens, so it is
 * safe to call on every launch.
 */
export function migrateLegacyUserData(newUserData: string, opts: MigrateLegacyOptions = {}): LegacyMigration {
  const target = path.resolve(newUserData);
  const derived = opts.legacyDir ? path.resolve(opts.legacyDir) : legacyUserDataDir(target);
  if (!derived) return { migrated: false, from: null, to: null, note: 'no-legacy-mapping' };
  const legacyDir = derived;

  if (legacyDir === target) return { migrated: false, from: null, to: null, note: 'same-path' };
  if (fs.existsSync(target)) return { migrated: false, from: null, to: null, note: 'target-exists' };
  if (!fs.existsSync(legacyDir) || !fs.statSync(legacyDir).isDirectory()) {
    return { migrated: false, from: null, to: null, note: 'no-legacy' };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(legacyDir, target);
  } catch (err) {
    // Rename fails across filesystems/volumes; fall back to a recursive copy and
    // leave the original in place rather than risk a partial move.
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      fs.cpSync(legacyDir, target, { recursive: true, errorOnExist: false });
    } else {
      throw err;
    }
  }

  // The app-named database and log files keep the old name after the move.
  renameByPrefix(target, LEGACY_DB, NEW_DB); // sevenvid.db plus -wal / -shm / -journal
  renameByPrefix(path.join(target, 'logs'), LEGACY_LOG, NEW_LOG); // sevenvid.log plus rotated .1 / .2 …

  return { migrated: true, from: legacyDir, to: target };
}

/** Renames every `<oldPrefix>`, `<oldPrefix>.<x>` and `<oldPrefix>-<x>` entry in `dir` to use `newPrefix`. */
function renameByPrefix(dir: string, oldPrefix: string, newPrefix: string): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name === oldPrefix || name.startsWith(`${oldPrefix}.`) || name.startsWith(`${oldPrefix}-`)) {
      const suffix = name.slice(oldPrefix.length);
      const from = path.join(dir, name);
      const to = path.join(dir, `${newPrefix}${suffix}`);
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    }
  }
}
