import { z } from 'zod';
import type { CapabilityId } from '../capabilities';

/** Every action the assistant can plan. Each maps to timeline commands or engine tasks and is verified after running. */
export const OPERATION_TYPES = [
  'trimStart',
  'trimEnd',
  'cutRange',
  'setDuration',
  'splitAt',
  'removeSilence',
  'blurFaces',
  'blurText',
  'enhanceAudio',
  'adjustVolume',
  'enhanceVideo',
  'upscale',
  'applyLook',
  'stabilize',
  'setAspect',
  'changeSpeed',
  'reverse',
  'freezeFrame',
  'generateSubtitles',
  'translateSubtitles',
  'burnSubtitles',
  'export',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const FaceSelectorSchema = z.enum(['all', 'largest', 'leftmost', 'rightmost', 'center', 'index']);
export const MaskKindParamSchema = z.enum(['blur', 'pixelate', 'box']);
export const LookSchema = z.enum(['natural', 'warm', 'cool', 'cinematic', 'vivid', 'mono']);
export const AudioPresetParamSchema = z.enum(['clean-voice', 'denoise', 'normalize', 'podcast', 'bright', 'warm']);
export const AspectParamSchema = z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']);
export const PlatformParamSchema = z.enum(['youtube', 'tiktok', 'reels', 'instagram-post', 'shorts', 'presentation']);
export const SubtitleLanguageSchema = z.enum(['auto', 'ar', 'en', 'fr', 'de', 'es', 'tr']);
export const DurationStrategySchema = z.enum(['trim-end', 'trim-start', 'speed', 'remove-silence-first']);

export const OperationParamsSchemas = {
  trimStart: z.object({ ms: z.number().int().min(1) }),
  trimEnd: z.object({ ms: z.number().int().min(1) }),
  cutRange: z.object({ startMs: z.number().int().min(0), endMs: z.number().int().min(1) }),
  setDuration: z.object({ targetMs: z.number().int().min(1000), strategy: DurationStrategySchema.nullable() }),
  splitAt: z.object({ atMs: z.number().int().min(1) }),
  removeSilence: z.object({ thresholdDb: z.number().optional(), minSilenceMs: z.number().int().optional(), paddingMs: z.number().int().optional() }),
  blurFaces: z.object({ selector: FaceSelectorSchema, index: z.number().int().min(0).optional(), kind: MaskKindParamSchema, shape: z.enum(['rect', 'ellipse']).optional(), strength: z.number().optional() }),
  blurText: z.object({ kind: MaskKindParamSchema }),
  enhanceAudio: z.object({ preset: AudioPresetParamSchema }),
  adjustVolume: z.object({ deltaDb: z.number().min(-60).max(30).optional(), mute: z.boolean().optional() }),
  enhanceVideo: z.object({ preset: z.enum(['auto', 'sharpen', 'denoise']) }),
  upscale: z.object({ factor: z.union([z.literal(2), z.literal(4)]).nullable(), targetHeight: z.number().int().nullable(), method: z.enum(['auto', 'lanczos', 'ai']) }),
  applyLook: z.object({ look: LookSchema.nullable(), adjust: z.object({ brightness: z.number().optional(), contrast: z.number().optional(), saturation: z.number().optional(), temperature: z.number().optional() }).optional() }),
  stabilize: z.object({}),
  setAspect: z.object({ aspect: AspectParamSchema, platform: PlatformParamSchema.nullable(), fit: z.enum(['cover', 'contain', 'blur-fill']).nullable() }),
  changeSpeed: z.object({ factor: z.number().min(0.1).max(16) }),
  reverse: z.object({}),
  freezeFrame: z.object({ atMs: z.number().int().min(0).nullable(), durationMs: z.number().int().min(100) }),
  generateSubtitles: z.object({ language: SubtitleLanguageSchema, style: z.enum(['default', 'tiktok', 'minimal', 'cinematic']).nullable(), burnIn: z.boolean() }),
  translateSubtitles: z.object({ targetLanguage: z.enum(['ar', 'en', 'fr', 'de', 'es', 'tr']) }),
  burnSubtitles: z.object({}),
  export: z.object({ platform: PlatformParamSchema.nullable(), presetId: z.string().nullable() }),
} as const satisfies Record<OperationType, z.ZodType>;

export type OperationParams<T extends OperationType = OperationType> = z.infer<(typeof OperationParamsSchemas)[T]>;

/** An operation as understood from the text, before planning resolves targets and feasibility. */
export type OperationDraft = {
  [T in OperationType]: { type: T; params: OperationParams<T>; confidence: number; text: string };
}[OperationType];

export const OperationDraftSchema = z.discriminatedUnion(
  'type',
  OPERATION_TYPES.map((t) => z.object({ type: z.literal(t), params: OperationParamsSchemas[t], confidence: z.number().min(0).max(1), text: z.string() })) as unknown as [z.ZodObject<{ type: z.ZodLiteral<OperationType> }>, ...z.ZodObject<{ type: z.ZodLiteral<OperationType> }>[]],
);

export interface OperationMeta {
  /** Changes the timeline structure or content in a way the user should confirm. */
  destructive: boolean;
  /** Runs as a background task rather than an instant command. */
  long: boolean;
  /** Capability that must be available for the operation to run (null = always possible with FFmpeg). */
  capability: CapabilityId | null;
  /** Operates on individual clips (targets are resolved by the planner). */
  clipScoped: boolean;
  group: 'edit' | 'privacy' | 'audio' | 'video' | 'subtitles' | 'export';
}

export const OPERATION_META: Record<OperationType, OperationMeta> = {
  trimStart: { destructive: true, long: false, capability: null, clipScoped: false, group: 'edit' },
  trimEnd: { destructive: true, long: false, capability: null, clipScoped: false, group: 'edit' },
  cutRange: { destructive: true, long: false, capability: null, clipScoped: false, group: 'edit' },
  setDuration: { destructive: true, long: false, capability: null, clipScoped: false, group: 'edit' },
  splitAt: { destructive: false, long: false, capability: null, clipScoped: false, group: 'edit' },
  removeSilence: { destructive: true, long: true, capability: null, clipScoped: false, group: 'audio' },
  blurFaces: { destructive: false, long: true, capability: 'vision.faces', clipScoped: true, group: 'privacy' },
  blurText: { destructive: false, long: true, capability: 'ocr', clipScoped: true, group: 'privacy' },
  enhanceAudio: { destructive: false, long: false, capability: null, clipScoped: true, group: 'audio' },
  adjustVolume: { destructive: false, long: false, capability: null, clipScoped: true, group: 'audio' },
  enhanceVideo: { destructive: false, long: false, capability: null, clipScoped: true, group: 'video' },
  upscale: { destructive: false, long: true, capability: 'upscale.lanczos', clipScoped: true, group: 'video' },
  applyLook: { destructive: false, long: false, capability: null, clipScoped: true, group: 'video' },
  stabilize: { destructive: false, long: false, capability: 'stabilize', clipScoped: true, group: 'video' },
  setAspect: { destructive: false, long: false, capability: null, clipScoped: false, group: 'edit' },
  changeSpeed: { destructive: true, long: false, capability: null, clipScoped: true, group: 'edit' },
  reverse: { destructive: false, long: false, capability: null, clipScoped: true, group: 'edit' },
  freezeFrame: { destructive: true, long: false, capability: null, clipScoped: false, group: 'edit' },
  generateSubtitles: { destructive: false, long: true, capability: 'stt', clipScoped: false, group: 'subtitles' },
  translateSubtitles: { destructive: false, long: true, capability: 'translate', clipScoped: false, group: 'subtitles' },
  burnSubtitles: { destructive: false, long: false, capability: null, clipScoped: false, group: 'subtitles' },
  export: { destructive: false, long: true, capability: 'render.export', clipScoped: false, group: 'export' },
};

export function isOperationType(value: unknown): value is OperationType {
  return typeof value === 'string' && (OPERATION_TYPES as readonly string[]).includes(value);
}

/** Validates loosely-typed params (from the rules or a language model) against the operation's schema. */
export function validateOperationParams(type: OperationType, params: unknown): { ok: true; params: OperationParams } | { ok: false; issues: string[] } {
  const schema = OperationParamsSchemas[type] as z.ZodType;
  const res = schema.safeParse(params);
  if (res.success) return { ok: true, params: res.data as OperationParams };
  return { ok: false, issues: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}
