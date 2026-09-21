import { newId } from '../ids';
import { normalizeText } from '../ai/numbers';
import type { Brief, CameraMove, Character, Script, ScriptScene } from './types';

const CAMERA_CYCLE: CameraMove[] = ['zoom-in', 'pan-right', 'static', 'zoom-out', 'pan-left', 'tilt-up'];

/** Splits free text into sentence-like beats (works for Arabic and Latin punctuation). */
export function splitBeats(text: string): string[] {
  return text
    .split(/[.!?؟\n،؛;]+|(?:\s-\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function titleCaseFromIdea(idea: string): string {
  const first = splitBeats(idea)[0] ?? idea;
  const words = first.trim().split(/\s+/).slice(0, 8).join(' ');
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}

/** Roughly how long a narration line should take, from its word count (min 1.8s). */
export function estimateNarrationMs(text: string, wordsPerMinute = 150): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 2000;
  return Math.max(1800, Math.round((words / wordsPerMinute) * 60_000));
}

const HOOK = { ar: 'مقدمة', en: 'Hook' };
const CTA = { ar: 'دعوة للتفاعل', en: 'Call to action' };
const SCENE = { ar: 'مشهد', en: 'Scene' };

/**
 * Deterministically turns a brief into a first-draft script (title, logline and scenes) with no language model.
 * A configured text model can rewrite this later; this scaffold is always available and fully editable, so the
 * Creator never depends on a model to reach a working script.
 */
export function buildScript(brief: Brief, characters: Character[] = []): Script {
  const lang = brief.language;
  const beats = splitBeats(brief.idea);
  const body = beats.length > 0 ? beats : [brief.idea.trim()];
  const title = titleCaseFromIdea(brief.idea);
  const nameInBeat = (beat: string): string[] => {
    const norm = normalizeText(beat);
    return characters.filter((c) => norm.includes(normalizeText(c.name))).map((c) => c.id);
  };

  const scenes: ScriptScene[] = [];
  let index = 0;
  const push = (heading: string, narration: string, action: string, camera: CameraMove) => {
    const characterIds = nameInBeat(narration) || [];
    scenes.push({
      id: newId('scn'),
      index: index++,
      heading,
      action,
      narration,
      dialogue: [],
      durationMs: estimateNarrationMs(narration),
      camera,
      characterIds,
      prompt: promptFor(brief, narration, characters.filter((c) => characterIds.includes(c.id))),
      negativePrompt: defaultNegativePrompt(brief),
    });
  };

  // Hook
  const hook = lang === 'ar' ? `${title}` : `${title}`;
  push(`${HOOK[lang]}`, hook, lang === 'ar' ? 'لقطة افتتاحية تجذب الانتباه.' : 'An attention-grabbing opening shot.', 'zoom-in');
  // Body beats
  body.forEach((beat, i) => push(`${SCENE[lang]} ${i + 1}`, beat, lang === 'ar' ? 'لقطة توضّح الفكرة.' : 'A shot illustrating the point.', CAMERA_CYCLE[i % CAMERA_CYCLE.length]!));
  // CTA
  const cta = brief.callToAction.trim() || (lang === 'ar' ? 'تابعنا للمزيد.' : 'Follow for more.');
  push(`${CTA[lang]}`, cta, lang === 'ar' ? 'لقطة ختامية مع الدعوة.' : 'A closing shot with the call to action.', 'zoom-out');

  // Scale scene durations so the total roughly matches the requested length.
  const total = scenes.reduce((s, sc) => s + sc.durationMs, 0);
  const target = brief.durationSec * 1000;
  const factor = total > 0 ? target / total : 1;
  for (const sc of scenes) sc.durationMs = Math.max(1500, Math.round((sc.durationMs * factor) / 100) * 100);

  const logline = lang === 'ar' ? `فيديو ${brief.durationSec} ثانية بأسلوب ${styleLabel(brief.style, 'ar')} عن: ${title}` : `A ${brief.durationSec}s ${styleLabel(brief.style, 'en')} video about: ${title}`;
  return { title, logline, scenes };
}

function styleLabel(style: Brief['style'], lang: 'ar' | 'en'): string {
  const map: Record<string, [string, string]> = {
    realistic: ['واقعي', 'realistic'],
    cinematic: ['سينمائي', 'cinematic'],
    documentary: ['وثائقي', 'documentary'],
    animation: ['رسوم متحركة', 'animation'],
    minimal: ['بسيط', 'minimal'],
    vlog: ['فلوق', 'vlog'],
    corporate: ['مؤسسي', 'corporate'],
  };
  return (map[style] ?? ['سينمائي', 'cinematic'])[lang === 'ar' ? 0 : 1];
}

/** Builds an English generation prompt (models expect English) describing the shot, style and any characters. */
export function promptFor(brief: Brief, beat: string, characters: Character[]): string {
  const parts: string[] = [];
  parts.push(beat.trim());
  if (characters.length) parts.push(characters.map((c) => `${c.name} (${[c.bible.age, c.bible.gender !== 'unspecified' ? c.bible.gender : '', c.bible.appearance, c.bible.hair, c.bible.clothing].filter(Boolean).join(', ')})`).join('; '));
  parts.push(`${styleLabel(brief.style, 'en')} style`);
  if (brief.style === 'realistic' || brief.style === 'cinematic' || brief.style === 'documentary') parts.push('photorealistic, natural lighting, high detail');
  parts.push(`${brief.aspect} aspect ratio`);
  return parts.filter(Boolean).join(', ');
}

export function defaultNegativePrompt(brief: Brief): string {
  const base = 'blurry, low quality, distorted, watermark, text artifacts, extra limbs, deformed';
  return brief.style === 'realistic' || brief.style === 'cinematic' ? `${base}, cartoon, illustration` : base;
}

export interface CreatorQaIssue {
  severity: 'error' | 'warning';
  code: string;
  sceneId: string | null;
  messageAr: string;
  messageEn: string;
}

/** Deterministic QA over a script: empty scenes, missing narration, duration drift, character consistency. */
export function reviewScript(brief: Brief, scenes: Array<{ id: string; scene: ScriptScene; voiceMs: number | null; consistency: { ok: boolean } | null; status: string }>): CreatorQaIssue[] {
  const issues: CreatorQaIssue[] = [];
  if (scenes.length === 0) issues.push({ severity: 'error', code: 'no-scenes', sceneId: null, messageAr: 'لا توجد مشاهد.', messageEn: 'There are no scenes.' });
  for (const s of scenes) {
    if (brief.narration && !s.scene.narration.trim() && s.scene.dialogue.length === 0) {
      issues.push({ severity: 'warning', code: 'empty-narration', sceneId: s.id, messageAr: `المشهد ${s.scene.index + 1} بلا سرد أو حوار.`, messageEn: `Scene ${s.scene.index + 1} has no narration or dialogue.` });
    }
    if (s.consistency && !s.consistency.ok) {
      issues.push({ severity: 'warning', code: 'inconsistent-character', sceneId: s.id, messageAr: `المشهد ${s.scene.index + 1}: الشخصية غير متّسقة مع المرجع.`, messageEn: `Scene ${s.scene.index + 1}: the character does not match the reference.` });
    }
  }
  const total = scenes.reduce((sum, s) => sum + s.scene.durationMs, 0);
  const target = brief.durationSec * 1000;
  if (target > 0 && Math.abs(total - target) / target > 0.35) {
    issues.push({ severity: 'warning', code: 'duration-drift', sceneId: null, messageAr: `المدة الإجمالية ${Math.round(total / 1000)}ث تبتعد عن الهدف ${brief.durationSec}ث.`, messageEn: `Total duration ${Math.round(total / 1000)}s is far from the ${brief.durationSec}s target.` });
  }
  return issues;
}
