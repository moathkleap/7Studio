import { z } from 'zod';

/** Generation quality levels map to provider parameters (steps, resolution, guidance). */
export const QualityLevelSchema = z.enum(['draft', 'balanced', 'high', 'maximum']);
export type QualityLevel = z.infer<typeof QualityLevelSchema>;

export const CreatorToneSchema = z.enum(['neutral', 'energetic', 'calm', 'serious', 'playful', 'inspirational', 'dramatic']);
export const CreatorStyleSchema = z.enum(['realistic', 'cinematic', 'documentary', 'animation', 'minimal', 'vlog', 'corporate']);
export const CameraMoveSchema = z.enum(['static', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down']);
export type CameraMove = z.infer<typeof CameraMoveSchema>;

/** The idea captured as a structured brief. Only `idea` is required; the rest have sensible defaults. */
export const BriefSchema = z.object({
  idea: z.string().min(1),
  language: z.enum(['ar', 'en']).default('ar'),
  durationSec: z.number().int().min(5).max(1800).default(30),
  tone: CreatorToneSchema.default('neutral'),
  style: CreatorStyleSchema.default('cinematic'),
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']).default('9:16'),
  narration: z.boolean().default(true),
  music: z.boolean().default(true),
  audience: z.string().default(''),
  callToAction: z.string().default(''),
});
export type Brief = z.infer<typeof BriefSchema>;

export const DialogueLineSchema = z.object({ character: z.string(), line: z.string() });
export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const ScriptSceneSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  heading: z.string(),
  action: z.string(),
  narration: z.string(),
  dialogue: z.array(DialogueLineSchema).default([]),
  durationMs: z.number().int().min(500),
  camera: CameraMoveSchema.default('static'),
  characterIds: z.array(z.string()).default([]),
  /** Positive prompt for an image/video model; kept even in animatic mode for the storyboard label. */
  prompt: z.string().default(''),
  negativePrompt: z.string().default(''),
});
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;

export const ScriptSchema = z.object({
  title: z.string(),
  logline: z.string(),
  scenes: z.array(ScriptSceneSchema),
});
export type Script = z.infer<typeof ScriptSchema>;

export const CharacterBibleSchema = z.object({
  age: z.string().default(''),
  gender: z.enum(['unspecified', 'male', 'female', 'nonbinary']).default('unspecified'),
  appearance: z.string().default(''),
  hair: z.string().default(''),
  clothing: z.string().default(''),
  personality: z.string().default(''),
  voice: z.object({ engine: z.enum(['espeak', 'piper']).default('espeak'), voice: z.string().default(''), rate: z.number().int().min(80).max(400).default(165) }).default({ engine: 'espeak', voice: '', rate: 165 }),
});
export type CharacterBible = z.infer<typeof CharacterBibleSchema>;

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  bible: CharacterBibleSchema,
  referenceImages: z.array(z.string()).default([]),
  hasEmbedding: z.boolean().default(false),
});
export type Character = z.infer<typeof CharacterSchema>;

export const SceneStatusSchema = z.enum(['draft', 'storyboard', 'voiced', 'generated', 'assembled', 'failed']);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

/** A shot as tracked by the Creator: the script scene plus its produced assets and QA. */
export const CreatorSceneSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  scene: ScriptSceneSchema,
  status: SceneStatusSchema,
  storyboardPath: z.string().nullable(),
  voicePath: z.string().nullable(),
  voiceMs: z.number().nullable(),
  generatedAssetId: z.string().nullable(),
  consistency: z.object({ score: z.number(), ok: z.boolean(), reason: z.string().nullable() }).nullable(),
});
export type CreatorScene = z.infer<typeof CreatorSceneSchema>;

/** How the video will be produced: a real generator when available, otherwise the honest animatic. */
export const ProductionModeSchema = z.enum(['animatic', 'image-model', 'video-model']);
export type ProductionMode = z.infer<typeof ProductionModeSchema>;
