import { normalizeText, numberWord, readNumber } from './numbers';
import { findRange, isTimecode, readDuration, readPoint, unitOf, type UnitKind } from './timeparse';
import type { OperationDraft, OperationParams, OperationType } from './operations';

export type IntentLanguage = 'ar' | 'en' | 'mixed' | 'unknown';

export interface IntentContext {
  /** Timeline duration, used to resolve "the end" and "keep from A to B". */
  durationMs?: number | null;
}

/** A question the planner must ask before an operation can run (the user picks one option). */
export interface Clarification {
  operationIndex: number;
  field: string;
  questionKey: string;
  params: Record<string, unknown>;
  options: Array<{ value: string | number | null; labelKey: string }>;
}

export interface ParsedClause {
  text: string;
  operations: OperationDraft[];
  understood: boolean;
}

export interface Interpretation {
  text: string;
  normalized: string;
  language: IntentLanguage;
  clauses: ParsedClause[];
  operations: OperationDraft[];
  clarifications: Clarification[];
  unknownClauses: string[];
  meta: 'undo' | 'redo' | 'help' | null;
  /** Mean confidence of the recognized operations (0 when nothing was recognized). */
  confidence: number;
}

interface Ctx {
  c: string;
  tokens: string[];
  totalMs: number | null;
  prevUnit: UnitKind | null;
  text: string;
}

type Draft<T extends OperationType> = { type: T; params: OperationParams<T>; confidence: number; text: string };

function op<T extends OperationType>(type: T, params: OperationParams<T>, confidence: number, text: string): OperationDraft {
  return { type, params, confidence, text } as Draft<T> as OperationDraft;
}

// ---------------------------------------------------------------------------------------------------------------------
// token helpers

const AR_PREFIXES = ['وال', 'بال', 'لل', 'كال', 'فال', 'ال', 'و', 'ب', 'ل', 'ف', 'ك'];

function strip(t: string): string {
  for (const p of AR_PREFIXES) if (t.startsWith(p) && t.length - p.length >= 2) return t.slice(p.length);
  return t;
}

function idx(tokens: string[], re: RegExp, from = 0): number {
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (re.test(t) || re.test(strip(t))) return i;
  }
  return -1;
}

function has(tokens: string[], re: RegExp): boolean {
  return idx(tokens, re) >= 0;
}

function en(c: string, re: RegExp): boolean {
  return re.test(c);
}

// ---------------------------------------------------------------------------------------------------------------------
// lexicon (normalized Arabic: no hamza forms, ة→ه, ي→ي)

const AR_DELETE = /^(احذف|حذف|امسح|مسح|ازل|ازيل|ازال|شيل|شل|قص|اقص|اقطع|قطع|الغ|نحذف|نقص|نشيل|بشيل|تحذف|تشيل|اشيل|احذفي|امسحي|قصي|اقطعي|حذفت|نزع|انزع)/;
const EN_DELETE = /\b(delete|remove|cut|trim|drop|chop|strip|erase|kill|take out|take off|get rid of|lose|skip|discard|clip off)\b/;
const AR_FIRST = /^(اول|بدايه|مقدمه|اوائل|بدايات)/;
const EN_FIRST = /\b(first|beginning|start|opening|intro|initial)\b/;
const AR_LAST = /^(اخر|نهايه|خاتمه|اخير|اواخر|نهايات)/;
const EN_LAST = /\b(last|final|end|ending|closing|outro)\b/;
const AR_VIDEO = /^(فيديو|مقطع|كليب|لقطه|فلم|فيلم|شريط|تسجيل)/;
const EN_VIDEO = /\b(video|clip|footage|film|movie|recording|it|this|everything|whole thing)\b/;
const AR_DURATION_NOUN = /^(مده|طول|مدته|طوله|مدتها|طولها|زمن|وقت)/;
const EN_DURATION_NOUN = /\b(duration|length|runtime|long)\b/;
const AR_MAKE = /^(خلي|خليه|خليها|اجعل|اجعله|اجعلها|حول|حوله|حولها|اختصر|اختصره|اختصرها|قصر|قصره|قصرها|اخل|خل|صير|صيره|سوي|سويه|اعمل|اعمله|اخلي|حدد|اضبط|ظبط|غير)/;
const EN_MAKE = /\b(make|set|shorten|reduce|limit|bring|compress|condense|fit|change|turn)\b/;
const AR_SILENCE = /^(سكوت|سكته|سكتات|صمت|فراغ|فراغات|وقفه|وقفات|توقف|سكون|هدوء|صامت|صامته|ساكت|ساكته|فاضيه|فارغه|الصمت)/;
const EN_SILENCE = /\b(silence|silences|silent|pause|pauses|dead air|dead space|gaps?|quiet parts?|empty parts?)\b/;
const AR_BLUR = /^(طمس|اطمس|طمّس|غبش|اغبش|بلر|بلور|شوش|موه|بكسل|فسفس|غطي|غط|اخفي|اخف|خفي|علم|احجب|حجب|عتم|ستر|استر|امسح|غطيه|اخفيه)/;
const EN_BLUR = /\b(blur|blurred|blurry|pixelate|pixelated|pixelize|mosaic|mask|hide|cover|obscure|anonymi[sz]e|censor|conceal|smudge|black out|blackout)\b/;
const AR_FACE = /^(وجه|وجوه|وش|وشوش|هويه|هويت|شخص|اشخاص|ناس|بشر|انسان|رجل|رجال|امراه|مرا|سيده|ولد|بنت|طفل|اطفال|شاب|شباب|ضيف|ضيوف|متحدث|الوجه)/;
const EN_FACE = /\b(face|faces|person|people|persons|identity|identities|everyone|everybody|guy|guys|woman|women|man|men|kid|kids|child|children|boy|girl|speaker|guest|guests)\b/;
const AR_TEXT = /^(نص|نصوص|كتابه|كتابات|كلمات|علامه|علامات|شعار|شعارات|لوغو|لوجو|عنوان|عناوين|كابشن|ووترمارك|ارقام|رقم|عناوين|اسم|اسماء|لوحه)/;
const EN_TEXT = /\b(text|texts|caption|captions|writing|words|watermark|watermarks|logo|logos|title|titles|banner|lower third|on-?screen text|license plate|plate|numbers?|names?|sign)\b/;
const AR_NOISE = /^(ضجيج|ضوضاء|تشويش|ازعاج|نويز|هسهسه|همهمه|طنين|وشوشه|صدي|خشخشه|ضجه)/;
const EN_NOISE = /\b(noise|noisy|hiss|hum|buzz|static|echo|reverb|background sound|background audio|background noise)\b/;
const AR_AUDIO = /^(صوت|اصوات|صوتيات|اوديو|كلام|صوتي|ميك|مايك|مايكروفون|الصوت|صوته|صوتها|تسجيل الصوت|فويس)/;
const EN_AUDIO = /\b(audio|sound|voice|speech|vocals?|mic|microphone|dialog|dialogue|narration|voiceover|voice-over)\b/;
const AR_IMPROVE = /^(حسن|حسّن|نظف|صلح|اصلح|عدل|ظبط|اضبط|طور|رتب|صفي|وضح|جود|حسني|نظفي|عالج|ارفع جوده|رفع|ارفع|زيد|زود)/;
const EN_IMPROVE = /\b(improve|enhance|clean|cleanup|clean up|fix|polish|better|clearer|crisper|boost|sweeten|treat|process|tune|upgrade|optimi[sz]e|repair|restore)\b/;
const AR_REDUCE = /^(قلل|خفف|قلّل|اخفض|خفض|نظف|صف|ازل|شيل|احذف|امسح|كتم|اكتم|هدي|ازيل|خلص|تخلص)/;
const EN_REDUCE = /\b(remove|reduce|cut|clean|kill|get rid of|suppress|lower|less|eliminate|filter|cancel|minimi[sz]e|denoise)\b/;
const AR_QUALITY = /^(جوده|دقه|وضوح|حده|نقاوه|نقاء|جودته|دقته|وضوحه|ريزولوشن)/;
const EN_QUALITY = /\b(quality|resolution|sharpness|clarity|definition|detail|details|crisp|crispness)\b/;
const AR_PICTURE = /^(صوره|الصوره|صور|بكسل|مشهد|مشاهد|كادر|اطار)/;
const EN_PICTURE = /\b(picture|image|visuals?|frame|frames|footage)\b/;
const AR_SUBTITLE = /^(ترجمه|ترجمات|تراجم|سبتايتل|سبتايتلز|كابشن|كابشنز|تفريغ|نصوص الكلام|ترجمتها)/;
const EN_SUBTITLE = /\b(subtitles?|subs|captions?|cc|closed captions|transcript|transcription|transcribe|transcribing)\b/;
const AR_ADD = /^(اضف|اضيف|ضيف|ضف|حط|حطي|اعمل|سوي|ولد|انشئ|اكتب|ركب|جهز|ابغي|ابي|بدي|اريد|عايز|عاوز|محتاج|فرغ|افرغ|نزل|اطلع|طلع|اصنع|ولّد|اضافه|اضيفي|ضيفي)/;
const EN_ADD = /\b(add|generate|create|make|put|write|insert|produce|give me|i want|i need|please add|auto|attach|include|build)\b/;
const AR_EXPORT = /^(صدر|صدّر|تصدير|اطلع|طلع|احفظ|حفظ|نزل|رندر|انشر|نشر|اخرج|خرج|جهزه للنشر)/;
const EN_EXPORT = /\b(export|render|save|download|output|publish|bounce|deliver)\b/;
const AR_STABILIZE = /^(ثبت|ثبّت|استقر|تثبيت|اهتزاز|مهتز|يهتز|اهتز|رجه|مرجوج|رجفه|يرجف|مرجرج|اهتزازات|اثبت)/;
const EN_STABILIZE = /\b(stabili[sz]e|stabili[sz]ation|shaky|shake|shaking|jittery|jitter|steady|steadier|wobbly|wobble|smooth out)\b/;
const AR_SPEED_UP = /^(سرع|سرّع|اسرع|سريع|تسريع|فاست|سرعه)/;
const EN_SPEED_UP = /\b(speed up|speed it up|faster|fast forward|quicker|accelerate|time-?lapse|timelapse|speed)\b/;
const AR_SLOW = /^(بطئ|بطّئ|ابطئ|ابطي|بطيء|بطيئه|تبطيء|ابطا|سلو|بطي|بطيئ)/;
const EN_SLOW = /\b(slow down|slower|slow motion|slow-mo|slowmo|slow it down|slow)\b/;
const AR_REVERSE = /^(اعكس|عكس|بالعكس|بالمقلوب|مقلوب|معكوس|ريفيرس|اقلب|قلب|للخلف|بالخلف)/;
const EN_REVERSE = /\b(reverse|reversed|backwards|backward|rewind|play back|in reverse)\b/;
const AR_FREEZE = /^(جمد|جمّد|تجميد|فريز|جمدي)/;
const EN_FREEZE = /\b(freeze|freeze-frame|hold the frame|still frame|pause on|hold on)\b/;
const AR_SPLIT = /^(قسم|قسّم|اقسم|افصل|فصل|جزء|جزئ|اقطع|قطع|قص|اقص|فرق)/;
const EN_SPLIT = /\b(split|cut|divide|separate|slice|break)\b/;
const AR_AT = /^(عند|في|علي|بالدقيقه|بالثانيه|بالوقت|بلحظه|لحظه)$/;
const EN_AT = /^(at|on|around|near)$/;
const AR_FOR = /^(لمده|لفتره|بمقدار|مده)$/;
const EN_FOR = /^(for|during|lasting)$/;
const AR_TRANSLATE = /^(ترجم|ترجمي|ترجموا|ترجمها)$/;
const AR_BURN = /^(احرق|حرق|ادمج|دمج|اطبع|طبع|الصق|لصق|ثبت|ثبّت|اخبز|ضمن|ضمّن)/;
const EN_BURN = /\b(burn|burn-in|burned|burnt|hardcode|hard-code|hardcoded|hardsub|hardsubs|embed|bake|baked)\b/;
const AR_PRO = /^(احتراف|احترافي|احترافيه|احترافيا|محترف|محترفه|بروفيشنال|برو)/;
const EN_PRO = /\b(professional|professionally|polished|polish|pro|premium|studio quality|broadcast quality|cinema quality|slick)\b/;
const AR_UNDO = /^(تراجع|رجع|ارجع|الغي|الغ|ترجع|رجعه|رجعها|ارجعه)/;
const EN_UNDO = /^(undo|revert|go back|take that back|never ?mind|cancel that|scratch that)/;
const AR_REDO = /^(اعد|كرر|اعاده|ريدو)/;
const EN_REDO = /^(redo)/;
const AR_HELP = /^(مساعده|ساعدني|ساعد|شو تقدر|ايش تقدر|وش تقدر|ماذا تستطيع|ماذا يمكنك|شو بتعرف|كيف استخدم|امثله|مثال|الاوامر)/;
const EN_HELP = /^(help|what can you do|what do you do|commands|examples|how do i use|show me examples)/;
const AR_DARK = /^(غامق|مظلم|معتم|ظلمه|عتمه|داكن|مظلمه|غامقه|داكنه)/;
const EN_DARK = /\b(dark|darker|dim|too dark|underexposed|gloomy)\b/;
const AR_BRIGHT = /^(سطوع|اضاءه|نور|ضوء|اناره|فاتح|ساطع|فاتحه|ساطعه|منور|منوره|مضيء)/;
const EN_BRIGHT = /\b(bright|brighter|brightness|light|lighter|lighten|exposure|too bright|overexposed|washed out|blown out)\b/;

const SPLIT_VERBS =
  'احذف|حذف|امسح|ازل|شيل|قص|اقص|اقطع|طمس|غبش|اخفي|اضف|ضيف|ضف|حط|اعمل|سوي|حسن|نظف|ارفع|خلي|اجعل|اختصر|سرع|بطئ|اعكس|ثبت|ترجم|صدر|قسم|زيد|قلل|اكتم|جمد|حول|غير|طبع|وحد|شوش|بكسل|ركب|ولد|انشئ|اكتب|افصل|غطي|علي|نزل|اخفض|طور|زود|احرق|ادمج|صلح|اصلح|عدل|ظبط|اضبط|خفف|اخل|غط|بلر|فرغ|افرغ|بدي|ابغي|اريد|عايز|محتاج|اقلب|قلب|خفض|احفظ|اطلع|طلع|اظهر|صير|قصر|كتم|هدي|رجع|ارجع|عالج|اخر|اول|الاخر|الاول|من';
const EN_SPLIT_WORDS =
  'delete|remove|cut|trim|drop|blur|pixelate|hide|cover|mask|add|generate|create|make|put|improve|enhance|clean|fix|reduce|normalize|normalise|speed|slow|reverse|stabilize|stabilise|translate|export|save|split|increase|lower|raise|mute|freeze|convert|turn|upscale|sharpen|brighten|darken|the last|the first|last|first|also|then|from|between|keep|get rid|strip|boost|render|burn|apply|give|set|shorten|limit|change|take|chop|skip|denoise|level|balance|kill|black out|censor|anonymize|anonymise';

/** Splits the normalized text into clauses on punctuation, conjunctions and Arabic "و" prefixes glued to verbs. */
export function splitClauses(normalized: string): string[] {
  let s = normalized
    .replace(/(between\s+\S+)\s+and\s+/g, '$1 to ')
    .replace(/(بين\s+\S+)\s+و\s*/g, '$1 الي ')
    .replace(/[،,;؛\n|]+/g, ' | ')
    .replace(/\s+(ثم|وبعدين|بعدين|وكمان|كمان|وايضا|ايضا|وبعدها|بعدها|وبعد ذلك|بعد ذلك)\s+/g, ' | ')
    .replace(/\s+(then|also|plus|and then|after that|afterwards|next)\s+/g, ' | ')
    .replace(new RegExp(`\\s+and\\s+(?=(?:${EN_SPLIT_WORDS})\\b)`, 'g'), ' | ')
    .replace(new RegExp(`\\s+و\\s+(?=(?:${SPLIT_VERBS}))`, 'g'), ' | ')
    .replace(new RegExp(`\\s+و(?=(?:${SPLIT_VERBS}))`, 'g'), ' | ');
  s = s.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '');
  return s
    .split('|')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function detectLanguage(text: string): IntentLanguage {
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  const la = (text.match(/[A-Za-z]/g) ?? []).length;
  if (ar === 0 && la === 0) return 'unknown';
  if (ar >= 3 && la >= 3 && Math.min(ar, la) / Math.max(ar, la) >= 0.1) return 'mixed';
  return ar >= la ? 'ar' : 'en';
}

// ---------------------------------------------------------------------------------------------------------------------
// matchers

function durationAfter(tokens: string[], at: number, prevUnit: UnitKind | null): { ms: number; explicit: boolean; next: number } | null {
  // allow one filler token: "اول ال 20 ثانيه", "the first ten seconds"
  for (let j = at + 1; j <= Math.min(at + 2, tokens.length - 1); j++) {
    const d = readDuration(tokens, j, prevUnit ?? 's');
    if (d) return { ms: d.ms, explicit: d.explicitUnit, next: d.next };
  }
  return null;
}

function durationBefore(tokens: string[], at: number, prevUnit: UnitKind | null): { ms: number; explicit: boolean } | null {
  // "20 ثانيه من البدايه", "10 seconds from the start"
  for (let j = Math.max(0, at - 4); j < at; j++) {
    const d = readDuration(tokens, j, prevUnit ?? 's');
    if (d && d.next <= at) return { ms: d.ms, explicit: d.explicitUnit };
  }
  return null;
}

function matchMeta(x: Ctx): 'undo' | 'redo' | 'help' | null {
  const first = x.tokens[0] ?? '';
  if (AR_UNDO.test(first) || EN_UNDO.test(x.c)) {
    // "الغي" alone or "الغي اخر شي" → undo; "الغي الترجمه" is not
    if (/^(الغي|الغ)/.test(first) && x.tokens.length > 1 && !/^(اخر|الاخر|التعديل|اخر تعديل|اخر شي|اخر شيء|هذا|ذلك|كل شي)/.test(x.tokens[1] ?? '')) return null;
    return 'undo';
  }
  if (AR_REDO.test(first) || EN_REDO.test(x.c)) return 'redo';
  if (AR_HELP.test(x.c) || EN_HELP.test(x.c)) return 'help';
  return null;
}

function matchSubtitles(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const subtitleNoun = has(tokens, AR_SUBTITLE) || en(c, EN_SUBTITLE);
  const langOf = (): OperationParams<'generateSubtitles'>['language'] => {
    if (has(tokens, /^(عربي|عربيه|arabic)$/)) return 'ar';
    if (has(tokens, /^(انجليزي|انجليزيه|انكليزي|انكليزيه|انقليزي|انقليزيه|english)$/)) return 'en';
    if (has(tokens, /^(فرنسي|فرنسيه|french)$/)) return 'fr';
    if (has(tokens, /^(الماني|المانيه|german)$/)) return 'de';
    if (has(tokens, /^(اسباني|اسبانيه|spanish)$/)) return 'es';
    if (has(tokens, /^(تركي|تركيه|turkish)$/)) return 'tr';
    return 'auto';
  };
  // translate existing subtitles
  if (subtitleNoun && (has(tokens, AR_TRANSLATE) || en(c, /\btranslate\b/))) {
    const lang = langOf();
    if (lang === 'auto') return [op('translateSubtitles', { targetLanguage: 'en' }, 0.5, x.text)];
    return [op('translateSubtitles', { targetLanguage: lang }, 0.9, x.text)];
  }
  // burn-in
  if (subtitleNoun && (has(tokens, AR_BURN) || en(c, EN_BURN))) return [op('burnSubtitles', {}, 0.85, x.text)];
  // "ترجم الفيديو" without a subtitle noun = generate subtitles (speech → text) in the requested language
  const translateVideo = !subtitleNoun && has(tokens, /^(ترجم|ترجمي)$/) && (has(tokens, AR_VIDEO) || has(tokens, /^(كلام|الكلام|حديث|الحديث|الصوت)$/) || tokens.length <= 3);
  if (!subtitleNoun && !translateVideo && !en(c, /\btranscribe\b/)) return null;
  if (subtitleNoun && (has(tokens, AR_DELETE) || en(c, /\b(delete|remove|drop|strip)\b/)) && !has(tokens, AR_ADD) && !en(c, EN_ADD)) return null; // removing subtitles is not planned
  const style: OperationParams<'generateSubtitles'>['style'] = /تيك\s?توك|تيكتوك|tiktok|tik tok|ريلز|reels?\b|شورتس|shorts\b/.test(c) ? 'tiktok' : has(tokens, /^(بسيط|بسيطه|minimal|minimalist|simple|clean)$/) ? 'minimal' : has(tokens, /^(سينمائي|سينمائيه|cinematic)$/) ? 'cinematic' : null;
  const burnIn = has(tokens, AR_BURN) || en(c, EN_BURN) || has(tokens, /^(محروق|محروقه|مدمج|مدمجه|مطبوع|مطبوعه|مثبته|مثبت)$/) || en(c, /\b(burned|burnt|hardcoded|embedded|baked)\b/);
  const explicitVerb = has(tokens, AR_ADD) || en(c, EN_ADD) || translateVideo || en(c, /\btranscribe\b/);
  return [op('generateSubtitles', { language: langOf(), style, burnIn }, explicitVerb ? 0.9 : 0.7, x.text)];
}

function matchRemoveSilence(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  if (en(c, /\bsilence the (audio|sound|video|clip|track)\b/)) return null;
  const noun = has(tokens, AR_SILENCE) || en(c, EN_SILENCE);
  if (!noun) return null;
  const verb = has(tokens, AR_DELETE) || has(tokens, AR_REDUCE) || en(c, EN_DELETE) || en(c, EN_REDUCE) || en(c, /\b(tighten|skip|trim|no|without)\b/) || has(tokens, /^(بدون|بلا|من غير)$/);
  if (!verb && !en(c, /\b(silences|pauses|gaps)\b/)) return null;
  return [op('removeSilence', {}, verb ? 0.9 : 0.6, x.text)];
}

function matchRange(x: Ctx): OperationDraft[] | null {
  const { tokens, c, totalMs } = x;
  const range = findRange(tokens, totalMs);
  if (!range) return null;
  const keep = has(tokens, /^(خلي|ابق|ابقي|احتفظ|اترك|اتركي|خل|بس|فقط|احتفظي)$/) || en(c, /\b(keep|only|just)\b/);
  const del = has(tokens, AR_DELETE) || en(c, EN_DELETE);
  if (keep && !del) {
    if (totalMs == null) return [op('cutRange', { startMs: 0, endMs: range.startMs }, 0.6, x.text)];
    const ops: OperationDraft[] = [];
    if (range.endMs < totalMs) ops.push(op('trimEnd', { ms: totalMs - range.endMs }, 0.85, x.text));
    if (range.startMs > 0) ops.push(op('trimStart', { ms: range.startMs }, 0.85, x.text));
    return ops.length ? ops : null;
  }
  return [op('cutRange', { startMs: range.startMs, endMs: range.endMs }, del ? 0.9 : 0.6, x.text)];
}

function matchTrim(x: Ctx, clar: Clarification[], baseIndex: number): OperationDraft[] | null {
  const { tokens, c, prevUnit } = x;
  const del = has(tokens, AR_DELETE) || en(c, EN_DELETE);
  const firstAt = idx(tokens, AR_FIRST) >= 0 ? idx(tokens, AR_FIRST) : en(c, EN_FIRST) ? tokens.findIndex((t) => EN_FIRST.test(t)) : -1;
  const lastAt = idx(tokens, AR_LAST) >= 0 ? idx(tokens, AR_LAST) : en(c, EN_LAST) ? tokens.findIndex((t) => EN_LAST.test(t)) : -1;
  const ops: OperationDraft[] = [];
  if (firstAt >= 0) {
    const d = durationAfter(tokens, firstAt, prevUnit) ?? durationBefore(tokens, firstAt, prevUnit);
    if (d && d.ms > 0) ops.push(op('trimStart', { ms: d.ms }, del ? 0.9 : 0.75, x.text));
  }
  if (lastAt >= 0) {
    const d = durationAfter(tokens, lastAt, prevUnit) ?? durationBefore(tokens, lastAt, prevUnit);
    if (d && d.ms > 0) ops.push(op('trimEnd', { ms: d.ms }, del ? 0.9 : 0.75, x.text));
  }
  if (ops.length) return ops;
  if (!del) return null;
  // "احذف 10 ثواني" without saying where: ask
  const bare = findFirstDuration(tokens, prevUnit);
  if (!bare || !bare.explicit) return null;
  if (idx(tokens, AR_AT) >= 0 || tokens.some((t) => EN_AT.test(t))) return null;
  if (has(tokens, AR_VIDEO) && (has(tokens, /^(ل|الي|لـ)$/) || tokens.some((t) => /^ل(?!ل)[؀-ۿ]/.test(t) && unitOf(t)))) return null; // "قص الفيديو لدقيقه" → setDuration
  if (en(c, /\b(to|down to|into)\b/)) return null;
  ops.push(op('trimStart', { ms: bare.ms }, 0.5, x.text));
  clar.push({ operationIndex: baseIndex, field: 'edge', questionKey: 'ai.clarify.edge', params: { ms: bare.ms }, options: [{ value: 'start', labelKey: 'ai.clarify.edgeStart' }, { value: 'end', labelKey: 'ai.clarify.edgeEnd' }] });
  return ops;
}

function findFirstDuration(tokens: string[], prevUnit: UnitKind | null): { ms: number; explicit: boolean; at: number } | null {
  for (let i = 0; i < tokens.length; i++) {
    const d = readDuration(tokens, i, prevUnit ?? 's');
    if (d) return { ms: d.ms, explicit: d.explicitUnit, at: i };
  }
  return null;
}

function matchSetDuration(x: Ctx, clar: Clarification[], baseIndex: number): OperationDraft[] | null {
  const { tokens, c, totalMs } = x;
  const make = has(tokens, AR_MAKE) || en(c, EN_MAKE);
  const del = has(tokens, AR_DELETE) || en(c, EN_DELETE);
  if (!make && !del) return null;
  if (idx(tokens, AR_FIRST) >= 0 || idx(tokens, AR_LAST) >= 0 || en(c, EN_FIRST) || en(c, EN_LAST)) return null;
  const object = has(tokens, AR_VIDEO) || has(tokens, AR_DURATION_NOUN) || en(c, EN_VIDEO) || en(c, EN_DURATION_NOUN);
  const toWord = has(tokens, /^(ل|الي|لـ|حتي|بطول|بمده)$/) || tokens.some((t) => /^ل(?!ل)/.test(t) && (unitOf(t) || isTimecode(t.slice(1)))) || en(c, /\b(to|down to|into|at)\b/);
  // duration with an explicit unit or a timecode
  let found: { ms: number; explicit: boolean } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const d = readDuration(tokens, i, null);
    if (d) {
      found = { ms: d.ms, explicit: d.explicitUnit };
      break;
    }
  }
  if (!found) return null;
  if (del && !toWord) return null;
  if (!object && !toWord) return null;
  const draft = op('setDuration', { targetMs: found.ms, strategy: null }, del || make ? 0.85 : 0.6, x.text);
  const longer = totalMs != null && found.ms > totalMs;
  clar.push({
    operationIndex: baseIndex,
    field: 'strategy',
    questionKey: longer ? 'ai.clarify.durationLonger' : 'ai.clarify.durationStrategy',
    params: { targetMs: found.ms, currentMs: totalMs },
    options: longer
      ? [{ value: 'speed', labelKey: 'ai.clarify.strategySlow' }]
      : [
          { value: 'trim-end', labelKey: 'ai.clarify.strategyTrimEnd' },
          { value: 'trim-start', labelKey: 'ai.clarify.strategyTrimStart' },
          { value: 'remove-silence-first', labelKey: 'ai.clarify.strategySilenceFirst' },
          { value: 'speed', labelKey: 'ai.clarify.strategySpeed' },
        ],
  });
  return [draft];
}

function maskKind(x: Ctx): OperationParams<'blurFaces'>['kind'] {
  const { tokens, c } = x;
  if (has(tokens, /^(بكسل|فسفس|فسيفساء|موزاييك|مبكسل|بيكسل)/) || en(c, /\b(pixelate|pixelated|pixelize|mosaic|pixels?)\b/)) return 'pixelate';
  if ((has(tokens, /^(مربع|صندوق|شريط|بلوك)/) || en(c, /\b(box|bar|black bar|block|rectangle)\b/)) && (has(tokens, /^(اسود|سوداء|غطي|غط)/) || en(c, /\b(black|cover|solid)\b/) || true)) return 'box';
  return 'blur';
}

function faceSelector(x: Ctx): { selector: OperationParams<'blurFaces'>['selector']; index?: number } {
  const { tokens, c } = x;
  if (has(tokens, /^(يمين|يمينا|يمني|يمني|ايمن|يمناء)/) || en(c, /\b(right|right-hand|rightmost)\b/)) return { selector: 'rightmost' };
  if (has(tokens, /^(يسار|يسري|يسري|ايسر|شمال|يساري)/) || en(c, /\b(left|left-hand|leftmost)\b/)) return { selector: 'leftmost' };
  if (has(tokens, /^(وسط|منتصف|وسطي|وسطاني)/) || en(c, /\b(center|centre|middle)\b/)) return { selector: 'center' };
  if (has(tokens, /^(كل|جميع|كلهم|كلها|الكل|الجميع|كامل)$/) || en(c, /\b(all|every|everyone|everybody|each|both|any)\b/)) return { selector: 'all' };
  if (has(tokens, /^(اكبر|اقرب|رئيسي|اساسي|كبير|قريب|الاكبر)/) || en(c, /\b(biggest|largest|main|closest|nearest|primary|big|large)\b/)) return { selector: 'largest' };
  if (has(tokens, /^(ثاني|ثانيه)$/) || en(c, /\b(second)\b/)) return { selector: 'index', index: 1 };
  if (has(tokens, /^(ثالث|ثالثه)$/) || en(c, /\b(third)\b/)) return { selector: 'index', index: 2 };
  if (has(tokens, /^(وجوه|وشوش|اشخاص|ناس|بشر|رجال|اطفال|شباب|ضيوف|هويات)/) || en(c, /\b(faces|people|persons|identities|everyone|guys|women|men|kids|children|guests)\b/)) return { selector: 'all' };
  return { selector: 'largest' };
}

function matchBlurText(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const verb = has(tokens, AR_BLUR) || en(c, EN_BLUR) || has(tokens, AR_DELETE) || en(c, EN_DELETE);
  if (!verb) return null;
  const textNoun = has(tokens, AR_TEXT) || en(c, EN_TEXT) || has(tokens, /^(مكتوب|مكتوبه|المكتوب)$/) || /العلامه المائيه|علامه مائيه/.test(c);
  if (!textNoun) return null;
  if (has(tokens, AR_SUBTITLE) || en(c, EN_SUBTITLE)) return null;
  return [op('blurText', { kind: maskKind(x) }, has(tokens, AR_BLUR) || en(c, EN_BLUR) ? 0.9 : 0.7, x.text)];
}

function matchBlurFaces(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const verb = has(tokens, AR_BLUR) || en(c, EN_BLUR);
  const face = has(tokens, AR_FACE) || en(c, EN_FACE);
  const identity = /اخفي الهويه|اخف الهويه|اخفاء الهويه|anonymi[sz]e|hide (his|her|their|the) identity|protect (his|her|their|the) identity/.test(c);
  if (!(verb && face) && !identity) return null;
  const sel = faceSelector(x);
  const shape: OperationParams<'blurFaces'>['shape'] = has(tokens, /^(دائره|دائري|بيضاوي|بيضاويه)/) || en(c, /\b(circle|circular|oval|ellipse|round)\b/) ? 'ellipse' : undefined;
  return [op('blurFaces', { selector: sel.selector, ...(sel.index != null ? { index: sel.index } : {}), kind: maskKind(x), ...(shape ? { shape } : {}) }, 0.9, x.text)];
}

function matchAudio(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const audioNoun = has(tokens, AR_AUDIO) || en(c, EN_AUDIO) || en(c, /\b(volume|louder|quieter|loud|quiet)\b/);
  const noise = has(tokens, AR_NOISE) || en(c, EN_NOISE);
  const videoNoun = has(tokens, AR_VIDEO) || has(tokens, AR_PICTURE) || en(c, /\b(video|picture|image|footage|grain|grainy)\b/);
  // noise
  if (noise && (!videoNoun || audioNoun)) {
    const verb = has(tokens, AR_REDUCE) || has(tokens, AR_DELETE) || en(c, EN_REDUCE) || en(c, EN_DELETE) || has(tokens, /^(بدون|بلا)$/) || en(c, /\b(no|without|denoise|noise reduction|noise removal)\b/);
    return [op('enhanceAudio', { preset: 'denoise' }, verb ? 0.9 : 0.7, x.text)];
  }
  if (en(c, /\bdenoise\b/) && !videoNoun) return [op('enhanceAudio', { preset: 'denoise' }, 0.9, x.text)];
  // mute
  if (en(c, /\bsilence the (audio|sound|video|clip|track)\b/) || en(c, /\b(mute|no sound|no audio|without audio|without sound|strip the audio|remove the audio|remove the sound|kill the audio)\b/) || has(tokens, /^(اكتم|كتم|اسكت|سكت|اصمت|صامت)$/) || /بدون صوت|بلا صوت|من غير صوت|شيل الصوت|احذف الصوت|امسح الصوت|ازل الصوت/.test(c)) {
    return [op('adjustVolume', { mute: true }, 0.9, x.text)];
  }
  if (!audioNoun) return null;
  // normalize
  if (has(tokens, /^(طبع|طبّع|وحد|ساوي|عادل|ثبت|توحيد|معايره|عاير|موازنه|وازن)/) || en(c, /\b(normali[sz]e|normali[sz]ation|level out|level the|even out|balance|consistent|same volume|loudness|equali[sz]e)\b/)) {
    return [op('enhanceAudio', { preset: 'normalize' }, 0.9, x.text)];
  }
  if (has(tokens, /^(بودكاست|بودكست|بود كاست)/) || en(c, /\bpodcast\b/)) return [op('enhanceAudio', { preset: 'podcast' }, 0.85, x.text)];
  // volume up/down
  const quality = has(tokens, AR_QUALITY) || en(c, EN_QUALITY);
  if (!quality) {
    if (has(tokens, /^(ارفع|رفع|زيد|زود|علي|اعلي|كبر|ضخم|رفعي|زيدي)$/) || en(c, /\b(louder|increase|raise|boost|turn (it )?up|pump (it )?up|amplify|volume up|crank)\b/)) {
      if (!has(tokens, AR_QUALITY) && !en(c, EN_QUALITY)) return [op('adjustVolume', { deltaDb: 6 }, 0.85, x.text)];
    }
    if (has(tokens, /^(اخفض|خفض|نزل|وطي|قلل|خفف|صغر|هدي|وطي|نزلي)$/) || en(c, /\b(quieter|lower|reduce|decrease|turn (it )?down|softer|volume down|bring down)\b/)) {
      return [op('adjustVolume', { deltaDb: -6 }, 0.85, x.text)];
    }
  }
  // warm / bright voice
  if (has(tokens, /^(دافئ|دافئه|دفء|ادفي|ادفا)/) || en(c, /\b(warm|warmer|warmth)\b/)) return [op('enhanceAudio', { preset: 'warm' }, 0.85, x.text)];
  if (has(tokens, /^(اوضح|وضوح|واضح|اصفي|صافي|نقي|انقي|حاد|لامع)/) || en(c, /\b(brighter|clearer|clarity|crisper|crisp|presence|sparkle)\b/)) return [op('enhanceAudio', { preset: 'clean-voice' }, 0.85, x.text)];
  // clean / improve
  if (has(tokens, AR_IMPROVE) || en(c, EN_IMPROVE) || quality) return [op('enhanceAudio', { preset: 'clean-voice' }, 0.9, x.text)];
  return null;
}

function matchStabilizeFreeze(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const frameNoun = has(tokens, /^(اطار|فريم|صوره|لقطه|كادر)/) || en(c, /\b(frame|shot|picture|image|still)\b/);
  if (has(tokens, AR_FREEZE) || en(c, EN_FREEZE) || (frameNoun && (has(tokens, /^(ثبت|ثبّت|وقف|اوقف)/) || en(c, /\b(hold|stop|pause)\b/)))) {
    let atMs: number | null = null;
    let durationMs = 2000;
    const atI = idx(tokens, AR_AT) >= 0 ? idx(tokens, AR_AT) : tokens.findIndex((t) => EN_AT.test(t));
    if (atI >= 0) {
      const p = readPoint(tokens, atI + 1, x.totalMs);
      if (p) atMs = p.ms;
    }
    const forI = idx(tokens, AR_FOR) >= 0 ? idx(tokens, AR_FOR) : tokens.findIndex((t) => EN_FOR.test(t));
    if (forI >= 0) {
      const d = readDuration(tokens, forI + 1, 's');
      if (d) durationMs = d.ms;
    } else if (atI < 0) {
      const d = findFirstDuration(tokens, null);
      if (d?.explicit) durationMs = d.ms;
    }
    return [op('freezeFrame', { atMs, durationMs }, 0.85, x.text)];
  }
  if (has(tokens, AR_STABILIZE) || en(c, EN_STABILIZE)) {
    if (has(tokens, AR_AUDIO) || en(c, EN_AUDIO)) return null;
    return [op('stabilize', {}, 0.9, x.text)];
  }
  return null;
}

function speedFactor(x: Ctx, slow: boolean): number {
  const { tokens, c } = x;
  let factor: number | null = null;
  const m = /(\d+(?:\.\d+)?)\s*(?:x|×|مرات|مره|اضعاف|ضعف|times|fold)\b/.exec(c) ?? /\bx\s*(\d+(?:\.\d+)?)/.exec(c);
  if (m) factor = Number(m[1]);
  else if (has(tokens, /^(مرتين|ضعفين|الضعف|ضعف)$/) || en(c, /\b(double|twice|2x)\b/)) factor = 2;
  else if (/ثلاث مرات|تلات مرات|ثلاثه اضعاف|three times|triple|3x/.test(c)) factor = 3;
  else if (/اربع مرات|اربعه اضعاف|four times|quadruple|4x/.test(c)) factor = 4;
  else if (has(tokens, /^(نص|نصف|النص|النصف|half)$/) || /half speed|half the speed|نص السرعه|نصف السرعه/.test(c)) factor = slow ? 2 : 0.5;
  else if (has(tokens, /^(ربع|الربع|quarter)$/)) factor = slow ? 4 : 0.25;
  else {
    const i = tokens.findIndex((t) => /^(مرات|مره|times)$/.test(t));
    if (i > 0) {
      const n = numberWord(tokens[i - 1]!);
      if (n) factor = n;
    }
  }
  if (factor == null) factor = 2;
  return slow ? 1 / factor : factor;
}

function matchSpeed(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const slowWords = has(tokens, AR_SLOW) || en(c, EN_SLOW) || /حركه بطيئه|سلو موشن|قلل السرعه|خفض السرعه|slow motion/.test(c);
  const fastWords = has(tokens, AR_SPEED_UP) || en(c, EN_SPEED_UP) || /زيد السرعه|ارفع السرعه|زود السرعه/.test(c);
  if (!slowWords && !fastWords) return null;
  if (slowWords) return [op('changeSpeed', { factor: Math.round(speedFactor(x, true) * 1000) / 1000 }, 0.9, x.text)];
  if (fastWords && has(tokens, /^(قلل|خفض|اخفض|نزل)$/)) return [op('changeSpeed', { factor: 0.5 }, 0.8, x.text)];
  return [op('changeSpeed', { factor: Math.round(speedFactor(x, false) * 1000) / 1000 }, 0.9, x.text)];
}

function matchReverse(x: Ctx): OperationDraft[] | null {
  if (has(x.tokens, AR_REVERSE) || en(x.c, EN_REVERSE)) return [op('reverse', {}, 0.9, x.text)];
  return null;
}

function matchSplit(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  if (!(has(tokens, AR_SPLIT) || en(c, EN_SPLIT))) return null;
  const atI = idx(tokens, AR_AT) >= 0 ? idx(tokens, AR_AT) : tokens.findIndex((t) => EN_AT.test(t));
  let point: { ms: number } | null = null;
  if (atI >= 0) point = readPoint(tokens, atI + 1, x.totalMs);
  if (!point) {
    const tc = tokens.find((t) => isTimecode(t));
    if (tc) point = readPoint([tc], 0, x.totalMs);
  }
  if (!point || point.ms <= 0) return null;
  return [op('splitAt', { atMs: point.ms }, 0.85, x.text)];
}

function matchVideoQuality(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const resolutionWord = has(tokens, /^(دقه|ريزولوشن|resolution)/) || en(c, /\b(upscale|up-scale|upscaling|4k|uhd|2160p?|1080p|1440p|8k|full hd|fullhd|hd)\b/) || has(tokens, /^(4k|٤k|8k|1080p|2160p)$/);
  const qualityWord = has(tokens, AR_QUALITY) || en(c, EN_QUALITY);
  const videoNoun = has(tokens, AR_VIDEO) || has(tokens, AR_PICTURE) || en(c, EN_VIDEO) || en(c, EN_PICTURE);
  const audioNoun = has(tokens, AR_AUDIO) || en(c, EN_AUDIO);
  const improveStrict = has(tokens, /^(حسن|حسّن|نظف|صلح|اصلح|عدل|ظبط|اضبط|طور|رتب|صفي|وضح|جود|عالج)/) || en(c, EN_IMPROVE);
  const generic = has(tokens, /^(ارفع|رفع|زيد|زود|كبر|اعلي|علي)$/) || en(c, /\b(increase|raise|make|up)\b/);
  const improve = improveStrict || (generic && qualityWord);
  if (audioNoun && !videoNoun) return null;
  if (resolutionWord && (improve || videoNoun || en(c, /\bupscale\b/) || has(tokens, /^(ارفع|رفع)$/))) {
    let targetHeight: number | null = null;
    let factor: 2 | 4 | null = null;
    if (/\b(4k|uhd|2160p?)\b|٤k/.test(c)) targetHeight = 2160;
    else if (/\b(1080p?|full hd|fullhd)\b/.test(c)) targetHeight = 1080;
    else if (/\b1440p?\b/.test(c)) targetHeight = 1440;
    else if (/\b8k\b/.test(c)) targetHeight = 4320;
    const f = /(\d)\s*x\b|\bx\s*(\d)\b|(\d)\s*(مرات|اضعاف|ضعف)/.exec(c);
    if (f) {
      const n = Number(f[1] ?? f[2] ?? f[3]);
      if (n === 2 || n === 4) factor = n;
    }
    if (has(tokens, /^(مرتين|ضعفين|الضعف)$/) || en(c, /\b(double|twice)\b/)) factor = 2;
    const method: OperationParams<'upscale'>['method'] = has(tokens, /^(ذكاء|بالذكاء|ai)$/) || en(c, /\b(ai|neural|esrgan)\b/) ? 'ai' : 'auto';
    return [op('upscale', { factor, targetHeight, method }, 0.85, x.text)];
  }
  const sharpen = has(tokens, /^(حده|حاد|وضوح|واضح|وضح|حدد|شارب)/) || en(c, /\b(sharpen|sharper|sharpness|crisp|crisper|clearer|clarity)\b/);
  const noise = has(tokens, AR_NOISE) || en(c, EN_NOISE) || has(tokens, /^(حبيبات|تحبب|محبب|مشوش)/) || en(c, /\b(grain|grainy|noisy|denoise)\b/);
  if ((qualityWord && (improve || videoNoun)) || (videoNoun && (improveStrict || sharpen || noise)) || (sharpen && !audioNoun && improveStrict)) {
    const preset: OperationParams<'enhanceVideo'>['preset'] = noise && !sharpen ? 'denoise' : sharpen && !noise ? 'sharpen' : 'auto';
    return [op('enhanceVideo', { preset }, qualityWord || improve ? 0.85 : 0.65, x.text)];
  }
  return null;
}

function matchLook(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const audioNoun = has(tokens, AR_AUDIO) || en(c, EN_AUDIO);
  if (audioNoun) return null;
  const inc = has(tokens, /^(زيد|زود|ارفع|رفع|علي|كثر|اكثر|زياده|اعلي|زيدي|اقوي|قوي)/) || en(c, /\b(increase|more|raise|boost|add|higher|up|bump)\b/);
  const dec = has(tokens, /^(قلل|خفف|اخفض|خفض|نزل|اقل|تقليل|هدي|قللي)/) || en(c, /\b(decrease|less|lower|reduce|drop|soften|tone down|down)\b/);
  if (/ابيض واسود|اسود وابيض|ابيض و اسود|اسود و ابيض|رمادي|احادي اللون|black and white|black & white|b&w|grayscale|greyscale|monochrome|mono\b|desaturate/.test(c)) return [op('applyLook', { look: 'mono' }, 0.9, x.text)];
  if (has(tokens, /^(سينمائي|سينمائيه|سينما|سينمائيا)/) || en(c, /\b(cinematic|film look|filmic|movie look|cinema)\b/)) return [op('applyLook', { look: 'cinematic' }, 0.9, x.text)];
  if (has(tokens, /^(دافئ|دافئه|دفء|ادفي|ادفا)/) || en(c, /\b(warm|warmer|warmth|golden)\b/)) return [op('applyLook', { look: 'warm' }, 0.85, x.text)];
  if (has(tokens, /^(بارد|بارده|برود|ابرد|ازرق)/) || en(c, /\b(cool|cooler|colder|cold|bluish|teal)\b/)) return [op('applyLook', { look: 'cool' }, 0.85, x.text)];
  if (has(tokens, /^(حيوي|حيويه|زاهي|زاهيه|مشبع|مشبعه|نابض|نابضه|قويه|قوي)/) || en(c, /\b(vivid|vibrant|punchy|punchier|pop|poppy|saturated|colou?rful)\b/)) return [op('applyLook', { look: 'vivid' }, 0.85, x.text)];
  if (has(tokens, /^(طبيعي|طبيعيه)/) || en(c, /\b(natural|neutral|normal colou?rs?)\b/)) return [op('applyLook', { look: 'natural' }, 0.8, x.text)];
  const colorNoun = has(tokens, /^(الوان|لون|تشبع|اشباع|ملون)/) || en(c, /\b(saturation|colou?rs?)\b/);
  if (colorNoun && inc) return [op('applyLook', { look: null, adjust: { saturation: 1.25 } }, 0.85, x.text)];
  if (colorNoun && dec) return [op('applyLook', { look: null, adjust: { saturation: 0.8 } }, 0.85, x.text)];
  const contrast = has(tokens, /^(تباين|كونتراست|كنتراست)/) || en(c, /\bcontrast\b/);
  if (contrast && inc) return [op('applyLook', { look: null, adjust: { contrast: 1.15 } }, 0.85, x.text)];
  if (contrast && dec) return [op('applyLook', { look: null, adjust: { contrast: 0.9 } }, 0.85, x.text)];
  const brightNoun = has(tokens, AR_BRIGHT) || en(c, EN_BRIGHT);
  const darkNoun = has(tokens, AR_DARK) || en(c, EN_DARK);
  if ((brightNoun && inc) || (darkNoun && !dec && !inc) || en(c, /\b(brighten|brighter|lighten|too dark)\b/) || has(tokens, /^(نور|نوره|نوري|فتح|افتح|فتحه)$/)) return [op('applyLook', { look: null, adjust: { brightness: 0.1 } }, 0.85, x.text)];
  if ((brightNoun && dec) || (darkNoun && (inc || has(tokens, /^(اغمق|غمق|عتم|اعتم|اظلم)$/))) || en(c, /\b(darken|darker|too bright|overexposed|washed out|blown out)\b/) || has(tokens, /^(اغمق|غمق|عتم|اعتم|اظلم)$/)) return [op('applyLook', { look: null, adjust: { brightness: -0.1 } }, 0.85, x.text)];
  return null;
}

interface PlatformHit {
  platform: OperationParams<'setAspect'>['platform'];
  aspect: OperationParams<'setAspect'>['aspect'];
}

function platformOf(c: string, tokens: string[]): PlatformHit | null {
  if (/تيك\s?توك|تيكتوك|تك توك|tiktok|tik tok|tik-tok/.test(c)) return { platform: 'tiktok', aspect: '9:16' };
  if (/شورتس|شورت|shorts?\b/.test(c) && /يوتيوب|يوتوب|youtube|you tube|شورتس|shorts\b/.test(c)) return { platform: 'shorts', aspect: '9:16' };
  if (/ريلز|\breels?\b|ريل\b/.test(c)) return { platform: 'reels', aspect: '9:16' };
  if (/انستا|انستقرام|انستغرام|انستجرام|instagram|\binsta\b|\big\b/.test(c)) return /بوست|منشور|\bpost\b|\bfeed\b|\bgrid\b/.test(c) ? { platform: 'instagram-post', aspect: '4:5' } : { platform: 'reels', aspect: '9:16' };
  if (/يوتيوب|يوتوب|youtube|you tube|\byt\b/.test(c)) return { platform: 'youtube', aspect: '16:9' };
  if (/سناب|snapchat|\bsnap\b|ستوري|stories|story\b/.test(c)) return { platform: null, aspect: '9:16' };
  if (/عرض تقديمي|بريزنتيشن|presentation|\bslides?\b|كي نوت|keynote|powerpoint/.test(c)) return { platform: 'presentation', aspect: '16:9' };
  if (has(tokens, /^(عمودي|عموديه|طولي|طوليه|راسي|راسيه|بورتريه|عامودي)/) || /\b(vertical|portrait|9:16|9x16|9 16)\b/.test(c) || has(tokens, /^9:16$/)) return { platform: null, aspect: '9:16' };
  if (has(tokens, /^(افقي|افقيه|عرضي|عرضيه|لاندسكيب)/) || /\b(landscape|horizontal|widescreen|16:9|16x9)\b/.test(c) || has(tokens, /^16:9$/)) return { platform: null, aspect: '16:9' };
  if (has(tokens, /^(مربع|مربعه|سكوير)/) || /\b(square|1:1|1x1)\b/.test(c) || has(tokens, /^1:1$/)) return { platform: null, aspect: '1:1' };
  if (has(tokens, /^4:5$/) || /\b4x5\b/.test(c)) return { platform: null, aspect: '4:5' };
  if (has(tokens, /^4:3$/) || /\b4x3\b/.test(c)) return { platform: null, aspect: '4:3' };
  return null;
}

function matchAspectExport(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  const hit = platformOf(c, tokens);
  const exportVerb = has(tokens, AR_EXPORT) || en(c, EN_EXPORT);
  if (!hit && !exportVerb) return null;
  const ops: OperationDraft[] = [];
  if (hit) {
    const fit: OperationParams<'setAspect'>['fit'] = has(tokens, /^(قص|اقص|اقطع|كروب|ملء|املا|املأ)/) || en(c, /\b(crop|fill|zoom)\b/) ? 'cover' : has(tokens, /^(غبش|بلر|طمس)/) || en(c, /\b(blur(red)? (background|bars|fill)|blur fill)\b/) ? 'blur-fill' : has(tokens, /^(اشرطه|شريط|سوداء|اسود)/) || en(c, /\b(bars|letterbox|pillarbox|fit)\b/) ? 'contain' : null;
    ops.push(op('setAspect', { aspect: hit.aspect, platform: hit.platform, fit }, exportVerb ? 0.7 : 0.9, x.text));
  }
  if (exportVerb) {
    const presetId = /\b(4k|uhd|2160)\b/.test(c) ? 'youtube-4k' : /جوده عاليه|اعلي جوده|high quality|best quality|max quality|highest quality/.test(c) ? 'high-quality' : /صغير|مضغوط|خفيف|small|compressed|light|web/.test(c) ? 'web-small' : null;
    ops.push(op('export', { platform: hit?.platform ?? null, presetId }, 0.85, x.text));
  }
  return ops;
}

function matchProfessional(x: Ctx): OperationDraft[] | null {
  const { tokens, c } = x;
  if (!(has(tokens, AR_PRO) || en(c, EN_PRO))) return null;
  return [
    op('enhanceAudio', { preset: 'clean-voice' }, 0.7, x.text),
    op('removeSilence', {}, 0.6, x.text),
    op('applyLook', { look: 'cinematic' }, 0.7, x.text),
    op('generateSubtitles', { language: 'auto', style: null, burnIn: false }, 0.6, x.text),
  ];
}

// ---------------------------------------------------------------------------------------------------------------------

function parseClause(text: string, totalMs: number | null, prevUnit: UnitKind | null, clarifications: Clarification[], baseIndex: number): { ops: OperationDraft[]; meta: Interpretation['meta']; lastUnit: UnitKind | null } {
  const c = text;
  const tokens = c.split(' ').filter(Boolean);
  const x: Ctx = { c, tokens, totalMs, prevUnit, text };
  const meta = matchMeta(x);
  if (meta) return { ops: [], meta, lastUnit: prevUnit };
  const chain: Array<(x: Ctx) => OperationDraft[] | null> = [
    matchSubtitles,
    matchRemoveSilence,
    matchRange,
    (y) => matchTrim(y, clarifications, baseIndex),
    (y) => matchSetDuration(y, clarifications, baseIndex),
    matchBlurFaces,
    matchBlurText,
    matchAudio,
    matchStabilizeFreeze,
    matchSpeed,
    matchReverse,
    matchSplit,
    matchVideoQuality,
    matchLook,
    matchAspectExport,
    matchProfessional,
  ];
  let ops: OperationDraft[] = [];
  for (const m of chain) {
    const r = m(x);
    if (r && r.length) {
      ops = r;
      break;
    }
  }
  // additive matchers: text + faces in one clause, platform mention next to another operation
  if (ops.length) {
    const first = ops[0]!;
    if (first.type === 'blurFaces') {
      const t = matchBlurText(x);
      if (t) ops.push(...t);
    } else if (first.type === 'blurText') {
      const f = matchBlurFaces(x);
      if (f) ops.push(...f);
    }
    if (first.type !== 'setAspect' && first.type !== 'export' && first.type !== 'generateSubtitles') {
      const hit = platformOf(c, tokens);
      if (hit && !ops.some((o) => o.type === 'setAspect')) ops.push(op('setAspect', { aspect: hit.aspect, platform: hit.platform, fit: null }, 0.6, text));
    }
  }
  // remember the unit of the last explicit duration for "وآخر 15"
  let lastUnit = prevUnit;
  for (let i = 0; i < tokens.length; i++) {
    const u = unitOf(tokens[i]);
    if (u && i > 0 && readNumber(tokens, i - 1)) lastUnit = u;
  }
  return { ops, meta: null, lastUnit };
}

/** Deterministic, bilingual interpretation of an editing request. Never throws; unknown text is reported as such. */
export function parseIntent(text: string, ctx: IntentContext = {}): Interpretation {
  const normalized = normalizeText(text);
  const language = detectLanguage(text);
  const clauses = splitClauses(normalized);
  const totalMs = ctx.durationMs ?? null;
  const parsed: ParsedClause[] = [];
  const operations: OperationDraft[] = [];
  const clarifications: Clarification[] = [];
  const unknownClauses: string[] = [];
  let meta: Interpretation['meta'] = null;
  let prevUnit: UnitKind | null = null;
  for (const clause of clauses) {
    const r = parseClause(clause, totalMs, prevUnit, clarifications, operations.length);
    prevUnit = r.lastUnit;
    if (r.meta) {
      meta = meta ?? r.meta;
      parsed.push({ text: clause, operations: [], understood: true });
      continue;
    }
    if (r.ops.length === 0) {
      unknownClauses.push(clause);
      parsed.push({ text: clause, operations: [], understood: false });
      continue;
    }
    parsed.push({ text: clause, operations: r.ops, understood: true });
    operations.push(...r.ops);
  }
  // drop duplicate operations produced by overlapping clauses (same type and params)
  const seen = new Set<string>();
  const unique: OperationDraft[] = [];
  const indexMap = new Map<number, number>();
  operations.forEach((o, i) => {
    const key = `${o.type}:${JSON.stringify(o.params)}`;
    if (seen.has(key)) return;
    seen.add(key);
    indexMap.set(i, unique.length);
    unique.push(o);
  });
  const clar = clarifications.filter((q) => indexMap.has(q.operationIndex)).map((q) => ({ ...q, operationIndex: indexMap.get(q.operationIndex)! }));
  const confidence = unique.length ? Math.round((unique.reduce((s, o) => s + o.confidence, 0) / unique.length) * 100) / 100 : 0;
  return { text, normalized, language, clauses: parsed, operations: unique, clarifications: clar, unknownClauses, meta, confidence };
}
