import { z } from 'zod';
import type { AppErrorInfo } from '@sevenvid/core';
import {
  AppErrorInfoSchema,
  AppInfoSchema,
  AppSettingsSchema,
  CapabilityInfoSchema,
  CommandSchema,
  DirEntrySchema,
  HardwareSnapshotSchema,
  LogEntrySchema,
  NotificationSchema,
  ProjectKindSchema,
  ProjectSummarySchema,
  ProjectVersionSchema,
  RecoveryInfoSchema,
  SearchResultSchema,
  SessionStateSchema,
  TaskInfoSchema,
  TemplateInfoSchema,
  ExportInfoSchema,
  NetworkLogEntrySchema,
} from './schemas';

const Void = z.void().or(z.undefined()).or(z.null());

/** Request/response channels. Every channel declares its input and output schema. */
export const channels = {
  'app.info': { input: Void, output: AppInfoSchema },
  'app.ping': { input: Void, output: z.object({ pong: z.literal(true), at: z.string() }) },
  'settings.get': { input: Void, output: AppSettingsSchema },
  'settings.update': { input: z.object({ patch: z.record(z.string(), z.unknown()) }), output: AppSettingsSchema },
  'settings.reset': { input: z.object({ section: z.string().nullable() }), output: AppSettingsSchema },
  'hardware.snapshot': { input: z.object({ refresh: z.boolean().optional() }).optional(), output: HardwareSnapshotSchema },
  'capabilities.get': { input: Void, output: z.record(z.string(), CapabilityInfoSchema) },
  'capabilities.refresh': { input: Void, output: z.record(z.string(), CapabilityInfoSchema) },
  'projects.list': { input: z.object({ includeDeleted: z.boolean().optional() }).optional(), output: z.array(ProjectSummarySchema) },
  'projects.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(ProjectSummarySchema) },
  'projects.create': {
    input: z.object({
      name: z.string().min(1),
      kind: ProjectKindSchema.optional(),
      templateId: z.string().nullable().optional(),
      platformPreset: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      fps: z.number().optional(),
    }),
    output: ProjectSummarySchema,
  },
  'projects.get': { input: z.object({ projectId: z.string() }), output: ProjectSummarySchema },
  'projects.open': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'projects.close': { input: z.object({ projectId: z.string() }), output: z.object({ closed: z.boolean() }) },
  'projects.rename': { input: z.object({ projectId: z.string(), name: z.string().min(1) }), output: ProjectSummarySchema },
  'projects.duplicate': { input: z.object({ projectId: z.string(), name: z.string().optional() }), output: ProjectSummarySchema },
  'projects.delete': { input: z.object({ projectId: z.string(), permanent: z.boolean().optional() }), output: z.object({ deleted: z.boolean() }) },
  'projects.restoreDeleted': { input: z.object({ projectId: z.string() }), output: ProjectSummarySchema },
  'projects.versions.list': { input: z.object({ projectId: z.string() }), output: z.array(ProjectVersionSchema) },
  'projects.versions.create': { input: z.object({ projectId: z.string(), label: z.string() }), output: ProjectVersionSchema },
  'projects.versions.restore': { input: z.object({ projectId: z.string(), versionId: z.string() }), output: SessionStateSchema },
  'projects.recovery.check': { input: Void, output: z.array(RecoveryInfoSchema) },
  'projects.recovery.apply': { input: z.object({ projectId: z.string(), discard: z.boolean().optional() }), output: SessionStateSchema.nullable() },
  'session.state': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'session.command': { input: z.object({ projectId: z.string(), command: CommandSchema }), output: SessionStateSchema },
  'session.undo': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'session.redo': { input: z.object({ projectId: z.string() }), output: SessionStateSchema },
  'session.save': { input: z.object({ projectId: z.string(), label: z.string().optional() }), output: SessionStateSchema },
  'session.validate': {
    input: z.object({ projectId: z.string() }),
    output: z.object({ ok: z.boolean(), errors: z.number(), warnings: z.number(), issues: z.array(z.record(z.string(), z.unknown())) }),
  },
  'tasks.list': { input: z.object({ projectId: z.string().nullable().optional(), includeFinished: z.boolean().optional(), limit: z.number().optional() }).optional(), output: z.array(TaskInfoSchema) },
  'tasks.get': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema.nullable() },
  'tasks.cancel': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.pause': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.resume': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.retry': { input: z.object({ taskId: z.string() }), output: TaskInfoSchema },
  'tasks.setPriority': { input: z.object({ taskId: z.string(), priority: z.number() }), output: TaskInfoSchema },
  'tasks.clearFinished': { input: Void, output: z.object({ removed: z.number() }) },
  'search.query': { input: z.object({ q: z.string(), types: z.array(z.string()).optional(), limit: z.number().optional() }), output: z.array(SearchResultSchema) },
  'logs.tail': { input: z.object({ limit: z.number().optional(), level: z.string().optional(), module: z.string().optional(), errorId: z.string().optional() }).optional(), output: z.array(LogEntrySchema) },
  'diagnostics.exportBundle': { input: z.object({ targetDir: z.string().nullable().optional() }).optional(), output: z.object({ path: z.string(), sizeBytes: z.number() }) },
  'errors.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(AppErrorInfoSchema) },
  'notifications.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(NotificationSchema) },
  'fs.listDir': { input: z.object({ path: z.string().nullable(), mediaOnly: z.boolean().optional() }), output: z.object({ path: z.string(), parent: z.string().nullable(), entries: z.array(DirEntrySchema) }) },
  'fs.roots': { input: Void, output: z.array(z.object({ label: z.string(), path: z.string() })) },
  'fs.exists': { input: z.object({ path: z.string() }), output: z.object({ exists: z.boolean(), isDirectory: z.boolean() }) },
  'dialog.pickFiles': {
    input: z.object({ kind: z.enum(['media', 'video', 'image', 'audio', 'subtitle', 'any']), multiple: z.boolean().optional(), title: z.string().optional() }),
    output: z.object({ paths: z.array(z.string()), native: z.boolean() }),
  },
  'dialog.pickDirectory': { input: z.object({ title: z.string().optional() }), output: z.object({ path: z.string().nullable(), native: z.boolean() }) },
  'dialog.saveFile': { input: z.object({ defaultPath: z.string().optional(), filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional() }), output: z.object({ path: z.string().nullable(), native: z.boolean() }) },
  'shell.openPath': { input: z.object({ path: z.string() }), output: z.object({ ok: z.boolean(), error: z.string().nullable() }) },
  'shell.showInFolder': { input: z.object({ path: z.string() }), output: z.object({ ok: z.boolean() }) },
  'shell.openExternal': { input: z.object({ url: z.string().url() }), output: z.object({ ok: z.boolean(), blocked: z.boolean() }) },
  'app.quit': { input: Void, output: z.object({ ok: z.boolean() }) },
  'templates.list': { input: Void, output: z.array(TemplateInfoSchema) },
  'templates.delete': { input: z.object({ templateId: z.string() }), output: z.object({ deleted: z.boolean() }) },
  'templates.saveFromProject': { input: z.object({ projectId: z.string(), name: z.string().min(1), category: z.string().optional() }), output: TemplateInfoSchema },
  'exports.list': { input: z.object({ projectId: z.string().optional(), limit: z.number().optional() }).optional(), output: z.array(ExportInfoSchema) },
  'network.recent': { input: z.object({ limit: z.number().optional() }).optional(), output: z.array(NetworkLogEntrySchema) },
} as const;

/** Push events from the engine to the UI. */
export const events = {
  'task.updated': TaskInfoSchema,
  'task.progress': z.object({ taskId: z.string(), progress: z.number(), message: z.string().nullable(), etaMs: z.number().nullable() }),
  'session.updated': z.object({ projectId: z.string(), state: SessionStateSchema, origin: z.enum(['command', 'undo', 'redo', 'ai', 'restore', 'save', 'external']) }),
  'session.closed': z.object({ projectId: z.string() }),
  'capabilities.updated': z.record(z.string(), CapabilityInfoSchema),
  'hardware.updated': HardwareSnapshotSchema,
  'settings.updated': AppSettingsSchema,
  'error': AppErrorInfoSchema,
  'notification': NotificationSchema,
  'log': LogEntrySchema,
  'projects.changed': z.object({ projectId: z.string().nullable(), reason: z.string() }),
  'recovery.available': z.array(RecoveryInfoSchema),
} as const;

export type ChannelMap = typeof channels;
export type ChannelName = keyof ChannelMap;
export type ChannelInput<C extends ChannelName> = z.input<ChannelMap[C]['input']>;
export type ChannelOutput<C extends ChannelName> = z.output<ChannelMap[C]['output']>;

export type EventMap = typeof events;
export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = z.output<EventMap[E]>;

export type ApiHandler<C extends ChannelName> = (input: ChannelInput<C>) => Promise<ChannelOutput<C>> | ChannelOutput<C>;
export type ApiHandlers = { [C in ChannelName]: ApiHandler<C> };

/** The single API surface exposed to the renderer (preload in Electron, WebSocket client in browser mode). */
export interface SevenvidApi {
  readonly mode: 'electron' | 'browser';
  invoke<C extends ChannelName>(channel: C, input?: ChannelInput<C>): Promise<ChannelOutput<C>>;
  subscribe<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): () => void;
}

export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo };

export function isChannel(name: string): name is ChannelName {
  return Object.prototype.hasOwnProperty.call(channels, name);
}

export function isEvent(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(events, name);
}
