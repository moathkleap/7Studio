import { formatMs } from '../time';
import type { OperationDraft, OperationType } from './operations';

export type Lang = 'ar' | 'en';

function clock(ms: number): string {
  return formatMs(ms, { millis: false });
}

/** A short human duration ("20 ثانية" / "1:30 minutes") for plan summaries. */
export function describeDuration(ms: number, lang: Lang): string {
  if (ms % 60_000 === 0 && ms >= 60_000) {
    const m = ms / 60_000;
    if (lang === 'ar') return m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : `${m} دقائق`;
    return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  if (ms < 60_000) {
    const s = Math.round(ms / 100) / 10;
    const n = Number.isInteger(s) ? String(s) : s.toFixed(1);
    if (lang === 'ar') return `${n} ثانية`;
    return `${n} ${s === 1 ? 'second' : 'seconds'}`;
  }
  return clock(ms);
}

const AR: Record<string, string> = {
  blur: 'طمس',
  pixelate: 'تبكيل',
  box: 'مربع أسود',
  all: 'كل الوجوه',
  largest: 'أكبر وجه',
  leftmost: 'الوجه على اليسار',
  rightmost: 'الوجه على اليمين',
  center: 'الوجه في الوسط',
  'clean-voice': 'صوت نقي',
  denoise: 'إزالة الضجيج',
  normalize: 'توحيد المستوى',
  podcast: 'بودكاست',
  bright: 'صوت واضح',
  warm: 'صوت دافئ',
  natural: 'طبيعي',
  cool: 'بارد',
  cinematic: 'سينمائي',
  vivid: 'زاهي',
  mono: 'أبيض وأسود',
  auto: 'تلقائي',
  sharpen: 'زيادة الحدة',
  ar: 'العربية',
  en: 'الإنجليزية',
  fr: 'الفرنسية',
  de: 'الألمانية',
  es: 'الإسبانية',
  tr: 'التركية',
  auto_lang: 'تلقائية',
};

const EN: Record<string, string> = {
  blur: 'blur',
  pixelate: 'pixelate',
  box: 'a black box',
  all: 'all faces',
  largest: 'the largest face',
  leftmost: 'the left face',
  rightmost: 'the right face',
  center: 'the center face',
  'clean-voice': 'clean voice',
  denoise: 'noise removal',
  normalize: 'loudness normalization',
  podcast: 'podcast',
  bright: 'brightened voice',
  warm: 'warm voice',
  natural: 'natural',
  cool: 'cool',
  cinematic: 'cinematic',
  vivid: 'vivid',
  mono: 'black and white',
  auto: 'auto',
  sharpen: 'sharpen',
  ar: 'Arabic',
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  tr: 'Turkish',
  auto_lang: 'automatic',
};

/** A single-sentence description of one planned operation, used in the plan preview and the final report. */
export function formatOperation(op: OperationDraft, lang: Lang): string {
  const w = lang === 'ar' ? AR : EN;
  const p = op.params as Record<string, unknown>;
  switch (op.type) {
    case 'trimStart':
      return lang === 'ar' ? `حذف أول ${describeDuration(p.ms as number, 'ar')}` : `Remove the first ${describeDuration(p.ms as number, 'en')}`;
    case 'trimEnd':
      return lang === 'ar' ? `حذف آخر ${describeDuration(p.ms as number, 'ar')}` : `Remove the last ${describeDuration(p.ms as number, 'en')}`;
    case 'cutRange':
      return lang === 'ar' ? `حذف المقطع من ${clock(p.startMs as number)} إلى ${clock(p.endMs as number)}` : `Cut from ${clock(p.startMs as number)} to ${clock(p.endMs as number)}`;
    case 'setDuration':
      return lang === 'ar' ? `ضبط المدة إلى ${describeDuration(p.targetMs as number, 'ar')}` : `Set the duration to ${describeDuration(p.targetMs as number, 'en')}`;
    case 'splitAt':
      return lang === 'ar' ? `تقسيم عند ${clock(p.atMs as number)}` : `Split at ${clock(p.atMs as number)}`;
    case 'removeSilence':
      return lang === 'ar' ? 'كشف فترات السكوت وإزالتها' : 'Detect and remove silent gaps';
    case 'blurFaces':
      return lang === 'ar' ? `${w[p.kind as string]} ${w[p.selector as string] ?? 'الوجه'}` : `${cap(w[p.kind as string]!)} ${w[p.selector as string] ?? 'the face'}`;
    case 'blurText':
      return lang === 'ar' ? `${w[p.kind as string]} النص الظاهر على الشاشة` : `${cap(w[p.kind as string]!)} on-screen text`;
    case 'enhanceAudio':
      return lang === 'ar' ? `تحسين الصوت (${w[p.preset as string]})` : `Enhance audio (${w[p.preset as string]})`;
    case 'adjustVolume':
      if (p.mute) return lang === 'ar' ? 'كتم الصوت' : 'Mute the audio';
      return lang === 'ar' ? `${(p.deltaDb as number) > 0 ? 'رفع' : 'خفض'} مستوى الصوت ${Math.abs(p.deltaDb as number)} ديسيبل` : `${(p.deltaDb as number) > 0 ? 'Raise' : 'Lower'} the volume by ${Math.abs(p.deltaDb as number)} dB`;
    case 'enhanceVideo':
      return lang === 'ar' ? `تحسين جودة الصورة (${w[p.preset as string]})` : `Improve the picture (${w[p.preset as string]})`;
    case 'upscale': {
      const target = p.targetHeight ? `${p.targetHeight}p` : p.factor ? `${p.factor}×` : lang === 'ar' ? 'أعلى' : 'higher';
      return lang === 'ar' ? `رفع الدقة إلى ${target}` : `Upscale to ${target}`;
    }
    case 'applyLook': {
      if (p.look) return lang === 'ar' ? `تطبيق مظهر ${w[p.look as string]}` : `Apply a ${w[p.look as string]} look`;
      const adj = p.adjust as Record<string, number> | undefined;
      const key = adj ? Object.keys(adj)[0] : undefined;
      const dir = key && adj && adj[key]! > (key === 'brightness' ? 0 : 1) ? (lang === 'ar' ? 'زيادة' : 'Increase') : lang === 'ar' ? 'خفض' : 'Decrease';
      const noun: Record<string, [string, string]> = { brightness: ['السطوع', 'brightness'], contrast: ['التباين', 'contrast'], saturation: ['التشبع', 'saturation'], temperature: ['الحرارة اللونية', 'color temperature'] };
      const n = key ? noun[key] ?? ['اللون', 'color'] : ['اللون', 'color'];
      return lang === 'ar' ? `${dir} ${n[0]}` : `${dir} ${n[1]}`;
    }
    case 'stabilize':
      return lang === 'ar' ? 'تثبيت اهتزاز الفيديو' : 'Stabilize the shaky video';
    case 'setAspect':
      return lang === 'ar' ? `تحويل نسبة العرض إلى ${p.aspect}${p.platform ? ` (${p.platform})` : ''}` : `Set the aspect ratio to ${p.aspect}${p.platform ? ` (${p.platform})` : ''}`;
    case 'changeSpeed': {
      const f = p.factor as number;
      return lang === 'ar' ? `${f >= 1 ? 'تسريع' : 'إبطاء'} السرعة ×${f}` : `${f >= 1 ? 'Speed up' : 'Slow down'} to ${f}×`;
    }
    case 'reverse':
      return lang === 'ar' ? 'عكس تشغيل الفيديو' : 'Reverse playback';
    case 'freezeFrame':
      return lang === 'ar' ? `تجميد إطار لمدة ${describeDuration(p.durationMs as number, 'ar')}` : `Freeze a frame for ${describeDuration(p.durationMs as number, 'en')}`;
    case 'generateSubtitles':
      return lang === 'ar' ? `إنشاء ترجمة ${w[(p.language as string) === 'auto' ? 'auto_lang' : (p.language as string)]}${p.burnIn ? ' محروقة' : ''}` : `Generate ${w[(p.language as string) === 'auto' ? 'auto_lang' : (p.language as string)]} subtitles${p.burnIn ? ' (burned in)' : ''}`;
    case 'translateSubtitles':
      return lang === 'ar' ? `ترجمة النصوص إلى ${w[p.targetLanguage as string]}` : `Translate subtitles to ${w[p.targetLanguage as string]}`;
    case 'burnSubtitles':
      return lang === 'ar' ? 'حرق الترجمة داخل الفيديو' : 'Burn subtitles into the video';
    case 'export':
      return lang === 'ar' ? 'تصدير الفيديو' : 'Export the video';
    default:
      return (op as { type: string }).type;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A short one-line summary of a whole plan. */
export function formatPlanSummary(ops: Array<{ type: OperationType }>, lang: Lang): string {
  const n = ops.length;
  if (n === 0) return lang === 'ar' ? 'لا توجد عمليات' : 'No operations';
  if (lang === 'ar') return `خطة من ${n} ${n === 1 ? 'عملية' : n === 2 ? 'عمليتين' : 'عمليات'}`;
  return `A plan with ${n} operation${n === 1 ? '' : 's'}`;
}
