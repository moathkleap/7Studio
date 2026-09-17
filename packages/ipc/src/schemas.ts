import { z } from 'zod';
import type { AppErrorInfo, CapabilityInfo, Command, ProjectDocument, AppSettings } from '@sevenvid/core';

/** Passthrough schema for large domain objects that are validated by the core package itself. */
export function passthrough<T>(check: (v: unknown) => boolean = () => true) {
  return z.custom<T>((v) => check(v));
}

export const ProjectDocumentSchema = passthrough<ProjectDocument>(
  (v) => typeof v === 'object' && v !== null && 'schemaVersion' in v && 'tracks' in v,
);
export const CommandSchema = passthrough<Command>((v) => typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string');
export const AppErrorInfoSchema = passthrough<AppErrorInfo>((v) => typeof v === 'object' && v !== null && 'errorId' in v);
export const CapabilityInfoSchema = passthrough<CapabilityInfo>((v) => typeof v === 'object' && v !== null && 'status' in v);
export const AppSettingsSchema = passthrough<AppSettings>((v) => typeof v === 'object' && v !== null && 'general' in v);

export const ProjectKindSchema = z.enum(['editor', 'creator']);

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProjectKindSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().nullable(),
  thumbnailPath: z.string().nullable(),
  durationMs: z.number(),
  width: z.number(),
  height: z.number(),
  dataDir: z.string(),
  deletedAt: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectVersionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  seq: z.number(),
  label: z.string().nullable(),
  reason: z.enum(['autosave', 'manual', 'ai', 'restore', 'creator', 'recovery']),
  hash: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});
export type ProjectVersion = z.infer<typeof ProjectVersionSchema>;

export const HistoryStateSchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  undoLabel: z.string().nullable(),
  redoLabel: z.string().nullable(),
  size: z.number(),
});

export const SaveStateSchema = z.object({
  dirty: z.boolean(),
  lastSavedAt: z.string().nullable(),
  saving: z.boolean(),
  lastError: AppErrorInfoSchema.nullable(),
});

export const SessionStateSchema = z.object({
  projectId: z.string(),
  document: ProjectDocumentSchema,
  history: HistoryStateSchema,
  save: SaveStateSchema,
  revision: z.number(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const TaskStatusSchema = z.enum(['queued', 'running', 'paused', 'done', 'failed', 'cancelled', 'interrupted']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskInfoSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  status: TaskStatusSchema,
  priority: z.number(),
  progress: z.number(),
  progressMessage: z.string().nullable(),
  etaMs: z.number().nullable(),
  params: z.record(z.string(), z.unknown()),
  result: z.unknown().nullable(),
  error: AppErrorInfoSchema.nullable(),
  attempts: z.number(),
  cancellable: z.boolean(),
  pausable: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type TaskInfo = z.infer<typeof TaskInfoSchema>;

export const GpuInfoSchema = z.object({
  vendor: z.string(),
  model: z.string(),
  vramMb: z.number().nullable(),
  vramUsedMb: z.number().nullable(),
  utilizationPercent: z.number().nullable(),
  temperatureC: z.number().nullable(),
  driver: z.string().nullable(),
  kind: z.enum(['nvidia', 'amd', 'intel', 'apple', 'other']),
  supportsCuda: z.boolean(),
});

export const HardwareSnapshotSchema = z.object({
  at: z.string(),
  os: z.object({ platform: z.string(), distro: z.string(), release: z.string(), arch: z.string() }),
  cpu: z.object({ brand: z.string(), cores: z.number(), physicalCores: z.number(), speedGhz: z.number().nullable(), loadPercent: z.number().nullable() }),
  memory: z.object({ totalMb: z.number(), usedMb: z.number(), availableMb: z.number() }),
  gpus: z.array(GpuInfoSchema),
  disks: z.array(z.object({ mount: z.string(), fs: z.string(), sizeMb: z.number(), usedMb: z.number(), availableMb: z.number() })),
  dataDisk: z.object({ mount: z.string(), sizeMb: z.number(), availableMb: z.number() }).nullable(),
  ffmpeg: z.object({ available: z.boolean(), version: z.string().nullable(), path: z.string().nullable(), hwEncoders: z.array(z.string()) }),
  python: z.object({ available: z.boolean(), version: z.string().nullable(), path: z.string().nullable(), venvReady: z.boolean(), device: z.string().nullable() }),
});
export type HardwareSnapshot = z.infer<typeof HardwareSnapshotSchema>;

export const RecoveryInfoSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  versionId: z.string().nullable(),
  journalEntries: z.number(),
  lastAutosaveAt: z.string().nullable(),
  reason: z.enum(['unclean-shutdown', 'journal-ahead']),
});
export type RecoveryInfo = z.infer<typeof RecoveryInfoSchema>;

export const LogEntrySchema = z.object({
  time: z.string(),
  level: z.string(),
  module: z.string().nullable(),
  operation: z.string().nullable(),
  taskId: z.string().nullable(),
  model: z.string().nullable(),
  durationMs: z.number().nullable(),
  status: z.string().nullable(),
  msg: z.string(),
  errorId: z.string().nullable(),
  raw: z.record(z.string(), z.unknown()),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const SearchResultSchema = z.object({
  type: z.enum(['project', 'asset', 'character', 'scene', 'operation', 'model', 'template']),
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  projectId: z.string().nullable(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  sizeBytes: z.number().nullable(),
  modifiedAt: z.string().nullable(),
  mediaKind: z.enum(['video', 'image', 'audio']).nullable(),
});
export type DirEntry = z.infer<typeof DirEntrySchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  level: z.enum(['info', 'success', 'warning', 'error']),
  titleKey: z.string(),
  messageKey: z.string().nullable(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  taskId: z.string().nullable(),
  errorId: z.string().nullable(),
  at: z.string(),
});
export type NotificationInfo = z.infer<typeof NotificationSchema>;

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  electron: z.string().nullable(),
  node: z.string(),
  mode: z.enum(['electron', 'browser']),
  paths: z.object({
    userData: z.string(),
    projects: z.string(),
    cache: z.string(),
    logs: z.string(),
    models: z.string(),
    exports: z.string(),
    resources: z.string(),
  }),
  isDev: z.boolean(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const TemplateInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  category: z.string(),
  builtin: z.boolean(),
  description: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  platformPreset: z.string().nullable(),
  settings: z.object({ width: z.number(), height: z.number(), fps: z.number(), aspectPreset: z.string() }).nullable(),
  subtitleStyle: z.record(z.string(), z.unknown()).nullable(),
  exportPresetId: z.string().nullable(),
  targetDurationMs: z.number().nullable(),
  createdAt: z.string(),
});
export type TemplateInfo = z.infer<typeof TemplateInfoSchema>;

export const ExportInfoSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  taskId: z.string().nullable(),
  presetId: z.string(),
  settings: z.record(z.string(), z.unknown()),
  outputPath: z.string(),
  status: z.enum(['queued', 'running', 'validating', 'done', 'failed', 'cancelled']),
  validation: z.record(z.string(), z.unknown()).nullable(),
  sizeBytes: z.number().nullable(),
  durationMs: z.number().nullable(),
  error: AppErrorInfoSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ExportInfo = z.infer<typeof ExportInfoSchema>;

export const NetworkLogEntrySchema = z.object({
  id: z.number(),
  ts: z.string(),
  providerId: z.string().nullable(),
  host: z.string(),
  purpose: z.string(),
  bytesOut: z.number(),
  bytesIn: z.number(),
  status: z.string(),
});
export type NetworkLogEntry = z.infer<typeof NetworkLogEntrySchema>;
