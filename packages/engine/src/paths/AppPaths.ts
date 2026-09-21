import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppPaths {
  userData: string;
  projects: string;
  cache: string;
  logs: string;
  models: string;
  exports: string;
  resources: string;
  tmp: string;
  venv: string;
  db: string;
}

export interface ResolvePathsOptions {
  userData?: string;
  resources?: string;
  projectsDir?: string | null;
  exportsDir?: string | null;
  modelsDir?: string | null;
}

/** Resolves all application directories. Env overrides let tests and browser mode run in an isolated tree. */
export function resolveAppPaths(opts: ResolvePathsOptions = {}): AppPaths {
  const userData = path.resolve(opts.userData ?? process.env.SEVENSTUDIOS_USER_DATA ?? path.join(os.homedir(), '.sevenstudios'));
  const resources = path.resolve(opts.resources ?? process.env.SEVENSTUDIOS_RESOURCES ?? path.join(process.cwd(), 'resources'));
  return {
    userData,
    projects: path.resolve(opts.projectsDir ?? process.env.SEVENSTUDIOS_PROJECTS_DIR ?? path.join(userData, 'projects')),
    cache: path.join(userData, 'cache'),
    logs: path.join(userData, 'logs'),
    models: path.resolve(opts.modelsDir ?? process.env.SEVENSTUDIOS_MODELS_DIR ?? path.join(userData, 'models')),
    exports: path.resolve(opts.exportsDir ?? process.env.SEVENSTUDIOS_EXPORTS_DIR ?? path.join(userData, 'exports')),
    resources,
    tmp: path.join(userData, 'tmp'),
    venv: path.join(userData, 'python-venv'),
    db: path.join(userData, 'sevenstudios.db'),
  };
}

export function ensureAppDirs(paths: AppPaths): void {
  for (const dir of [paths.userData, paths.projects, paths.cache, paths.logs, paths.models, paths.exports, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
