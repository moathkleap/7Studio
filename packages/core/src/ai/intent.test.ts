import { describe, expect, it } from 'vitest';
import { parseIntent, splitClauses } from './intent';
import { normalizeText, readNumber } from './numbers';
import { findRange, readDuration, readPoint } from './timeparse';
import type { OperationDraft } from './operations';

const types = (text: string, durationMs?: number) => parseIntent(text, { durationMs }).operations.map((o) => o.type);
const first = <T extends OperationDraft['type']>(text: string, durationMs?: number) => parseIntent(text, { durationMs }).operations[0] as Extract<OperationDraft, { type: T }>;
const tok = (s: string) => normalizeText(s).split(' ');

describe('numbers and durations', () => {
  it('reads Arabic and English number words', () => {
    expect(readNumber(tok('عشرين'), 0)?.value).toBe(20);
    expect(readNumber(tok('خمسة وعشرين'), 0)?.value).toBe(25);
    expect(readNumber(tok('مية وخمسين'), 0)?.value).toBe(150);
    expect(readNumber(tok('twenty five'), 0)?.value).toBe(25);
    expect(readNumber(tok('one hundred twenty'), 0)?.value).toBe(120);
    expect(readNumber(tok('٣٠'), 0)?.value).toBe(30);
    expect(readNumber(tok('1.5'), 0)?.value).toBe(1.5);
  });

  it('reads durations in both languages', () => {
    expect(readDuration(tok('20 ثانية'), 0)?.ms).toBe(20_000);
    expect(readDuration(tok('عشرين ثانية'), 0)?.ms).toBe(20_000);
    expect(readDuration(tok('دقيقتين'), 0)?.ms).toBe(120_000);
    expect(readDuration(tok('نص دقيقة'), 0)?.ms).toBe(30_000);
    expect(readDuration(tok('دقيقة ونص'), 0)?.ms).toBe(90_000);
    expect(readDuration(tok('خمس دقايق'), 0)?.ms).toBe(300_000);
    expect(readDuration(tok('1.5 min'), 0)?.ms).toBe(90_000);
    expect(readDuration(tok('half a minute'), 0)?.ms).toBe(30_000);
    expect(readDuration(tok('a minute and a half'), 0)?.ms).toBe(90_000);
    expect(readDuration(tok('one minute'), 0)?.ms).toBe(60_000);
    expect(readDuration(tok('1:30'), 0)?.ms).toBe(90_000);
    expect(readDuration(tok('15'), 0)).toMatchObject({ ms: 15_000, explicitUnit: false });
    expect(readDuration(tok('15'), 0, 'm')?.ms).toBe(900_000);
  });

  it('reads time points and ranges', () => {
    expect(readPoint(tok('الدقيقة 2:10'), 0, null)?.ms).toBe(130_000);
    expect(readPoint(tok('الدقيقة 2'), 0, null)?.ms).toBe(120_000);
    expect(readPoint(tok('الثانية 30'), 0, null)?.ms).toBe(30_000);
    expect(readPoint(tok('minute 2:10'), 0, null)?.ms).toBe(130_000);
    expect(findRange(tok('من 2:10 إلى 2:45'), null)).toMatchObject({ startMs: 130_000, endMs: 165_000 });
    expect(findRange(tok('from 1:00 to 1:30'), null)).toMatchObject({ startMs: 60_000, endMs: 90_000 });
    expect(findRange(tok('between 10 seconds and 20 seconds'), null)).toMatchObject({ startMs: 10_000, endMs: 20_000 });
    expect(findRange(tok('من الدقيقة 2 إلى الدقيقة 3'), null)).toMatchObject({ startMs: 120_000, endMs: 180_000 });
    expect(findRange(tok('من 0:10 للنهاية'), 60_000)).toMatchObject({ startMs: 10_000, endMs: 60_000 });
  });
});

describe('clause splitting', () => {
  it('splits Arabic conjunctions glued to verbs and English "and" before verbs', () => {
    expect(splitClauses(normalizeText('احذف أول 20 ثانية وآخر 15'))).toEqual(['احذف اول 20 ثانيه', 'اخر 15']);
    expect(splitClauses(normalizeText('احذف أول 10 ثواني، طمس الوجه، حسن الصوت، وأضف ترجمة'))).toHaveLength(4);
    expect(splitClauses(normalizeText('delete the first 20 seconds and the last 15'))).toEqual(['delete the first 20 seconds', 'the last 15']);
    expect(splitClauses(normalizeText('cut between 1:00 and 1:30 then blur the face'))).toEqual(['cut between 1:00 to 1:30', 'blur the face']);
    expect(splitClauses(normalizeText('طمس وجه الشخص على اليمين'))).toEqual(['طمس وجه الشخص علي اليمين']);
  });
});

describe('parseIntent — Arabic examples from the specification', () => {
  it('trims start and end', () => {
    const r = parseIntent('احذف أول 20 ثانية وآخر 15');
    expect(r.language).toBe('ar');
    expect(r.operations).toMatchObject([
      { type: 'trimStart', params: { ms: 20_000 } },
      { type: 'trimEnd', params: { ms: 15_000 } },
    ]);
    expect(r.unknownClauses).toEqual([]);
    expect(first<'trimStart'>('قص أول دقيقة').params.ms).toBe(60_000);
    expect(first<'trimEnd'>('شيل آخر ٣٠ ثانية').params.ms).toBe(30_000);
    expect(first<'trimStart'>('احذف 10 ثواني من البداية').params.ms).toBe(10_000);
    expect(first<'trimEnd'>('احذف 5 ثواني من النهاية').params.ms).toBe(5_000);
  });

  it('cuts ranges', () => {
    expect(first<'cutRange'>('احذف من 2:10 إلى 2:45').params).toEqual({ startMs: 130_000, endMs: 165_000 });
    expect(first<'cutRange'>('احذف الجزء من الدقيقة 1 إلى الدقيقة 2').params).toEqual({ startMs: 60_000, endMs: 120_000 });
    expect(first<'cutRange'>('اقطع من ٠:٣٠ لـ ٠:٤٥').params).toEqual({ startMs: 30_000, endMs: 45_000 });
  });

  it('sets the duration and asks for the strategy', () => {
    const r = parseIntent('خلي الفيديو دقيقة', { durationMs: 180_000 });
    expect(r.operations).toMatchObject([{ type: 'setDuration', params: { targetMs: 60_000, strategy: null } }]);
    expect(r.clarifications[0]).toMatchObject({ operationIndex: 0, field: 'strategy' });
    expect(r.clarifications[0]!.options.map((o) => o.value)).toContain('trim-end');
    expect(first<'setDuration'>('اجعل مدة الفيديو 30 ثانية').params.targetMs).toBe(30_000);
    expect(first<'setDuration'>('اختصره لدقيقة').params.targetMs).toBe(60_000);
    const longer = parseIntent('خلي الفيديو دقيقتين', { durationMs: 60_000 });
    expect(longer.clarifications[0]!.options.map((o) => o.value)).toEqual(['speed']);
  });

  it('removes silence', () => {
    expect(types('شيل فترات السكوت')).toEqual(['removeSilence']);
    expect(types('احذف السكوت')).toEqual(['removeSilence']);
    expect(types('امسح الفراغات الصامتة')).toEqual(['removeSilence']);
  });

  it('blurs faces with spatial selectors and mask kinds', () => {
    expect(first<'blurFaces'>('طمس وجه الشخص على اليمين').params).toMatchObject({ selector: 'rightmost', kind: 'blur' });
    expect(first<'blurFaces'>('غبش الوجه اللي على اليسار').params.selector).toBe('leftmost');
    expect(first<'blurFaces'>('طمس كل الوجوه').params.selector).toBe('all');
    expect(first<'blurFaces'>('اخفي الوجوه').params.selector).toBe('all');
    expect(first<'blurFaces'>('بكسل وجه الشخص في الوسط').params).toMatchObject({ selector: 'center', kind: 'pixelate' });
    expect(first<'blurFaces'>('غطي وجه الشخص الثاني بمربع أسود').params).toMatchObject({ selector: 'index', index: 1, kind: 'box' });
    expect(first<'blurFaces'>('اخفي هوية الشخص').params.selector).toBe('largest');
  });

  it('blurs on-screen text and watermarks', () => {
    expect(types('طمس النص')).toEqual(['blurText']);
    expect(types('غبش العلامة المائية')).toEqual(['blurText']);
    expect(types('طمس الوجوه والنصوص')).toEqual(['blurFaces', 'blurText']);
  });

  it('fits platforms and aspect ratios', () => {
    expect(first<'setAspect'>('خلي الفيديو مناسب للتيك توك').params).toMatchObject({ aspect: '9:16', platform: 'tiktok' });
    expect(first<'setAspect'>('حوله لفيديو عمودي').params.aspect).toBe('9:16');
    expect(first<'setAspect'>('خليه مربع للانستغرام بوست').params).toMatchObject({ aspect: '4:5', platform: 'instagram-post' });
    expect(first<'setAspect'>('حوله ليوتيوب').params).toMatchObject({ aspect: '16:9', platform: 'youtube' });
    expect(first<'setAspect'>('اعمله بصيغة 9:16').params.aspect).toBe('9:16');
  });

  it('enhances audio', () => {
    expect(first<'enhanceAudio'>('حسن الصوت').params.preset).toBe('clean-voice');
    expect(first<'enhanceAudio'>('حسّن الصوت').params.preset).toBe('clean-voice');
    expect(first<'enhanceAudio'>('نظف الصوت').params.preset).toBe('clean-voice');
    expect(first<'enhanceAudio'>('احذف الضجيج').params.preset).toBe('denoise');
    expect(first<'enhanceAudio'>('شيل الضوضاء من الخلفية').params.preset).toBe('denoise');
    expect(first<'enhanceAudio'>('وحد مستوى الصوت').params.preset).toBe('normalize');
    expect(first<'enhanceAudio'>('خلي الصوت بودكاست').params.preset).toBe('podcast');
    expect(first<'adjustVolume'>('ارفع الصوت').params.deltaDb).toBe(6);
    expect(first<'adjustVolume'>('اخفض الصوت').params.deltaDb).toBe(-6);
    expect(first<'adjustVolume'>('اكتم الصوت').params.mute).toBe(true);
  });

  it('enhances video quality and upscales', () => {
    expect(types('ارفع جودة الفيديو')).toEqual(['enhanceVideo']);
    expect(types('حسن جودة الصورة')).toEqual(['enhanceVideo']);
    expect(first<'upscale'>('ارفع دقة الفيديو إلى 4k').params.targetHeight).toBe(2160);
    expect(first<'upscale'>('ارفع الدقة مرتين').params.factor).toBe(2);
    expect(types('ثبت الفيديو')).toEqual(['stabilize']);
    expect(types('الفيديو مهتز')).toEqual(['stabilize']);
  });

  it('adjusts looks and colors', () => {
    expect(first<'applyLook'>('خليه أبيض وأسود').params.look).toBe('mono');
    expect(first<'applyLook'>('اعطيه لمسة سينمائية').params.look).toBe('cinematic');
    expect(first<'applyLook'>('زيد السطوع').params.adjust).toEqual({ brightness: 0.1 });
    expect(first<'applyLook'>('الفيديو غامق').params.adjust).toEqual({ brightness: 0.1 });
    expect(first<'applyLook'>('قلل الإضاءة').params.adjust).toEqual({ brightness: -0.1 });
    expect(first<'applyLook'>('زيد التباين').params.adjust).toEqual({ contrast: 1.15 });
    expect(first<'applyLook'>('خلي الألوان أقوى').params.adjust).toEqual({ saturation: 1.25 });
  });

  it('changes speed, reverses, freezes and splits', () => {
    expect(first<'changeSpeed'>('سرّع الفيديو مرتين').params.factor).toBe(2);
    expect(first<'changeSpeed'>('سرع الفيديو 3 مرات').params.factor).toBe(3);
    expect(first<'changeSpeed'>('بطّئ الفيديو').params.factor).toBe(0.5);
    expect(first<'changeSpeed'>('خليه حركة بطيئة').params.factor).toBe(0.5);
    expect(types('اعكس الفيديو')).toEqual(['reverse']);
    expect(first<'freezeFrame'>('جمد الإطار عند الثانية 5 لمدة 3 ثواني').params).toEqual({ atMs: 5_000, durationMs: 3_000 });
    expect(first<'splitAt'>('قسم الفيديو عند الدقيقة 1').params.atMs).toBe(60_000);
    expect(first<'splitAt'>('اقطع عند 0:30').params.atMs).toBe(30_000);
  });

  it('generates, translates and burns subtitles', () => {
    expect(first<'generateSubtitles'>('أضف ترجمة عربية').params).toMatchObject({ language: 'ar', burnIn: false });
    expect(first<'generateSubtitles'>('ضيف ترجمة انجليزية').params.language).toBe('en');
    expect(first<'generateSubtitles'>('اعمل ترجمة').params.language).toBe('auto');
    expect(first<'generateSubtitles'>('ترجمة بستايل تيك توك').params.style).toBe('tiktok');
    expect(first<'generateSubtitles'>('أضف ترجمة محروقة').params.burnIn).toBe(true);
    expect(first<'translateSubtitles'>('ترجم الترجمة للانجليزي').params.targetLanguage).toBe('en');
    expect(types('احرق الترجمة في الفيديو')).toEqual(['burnSubtitles']);
    expect(first<'generateSubtitles'>('ترجم الفيديو').params.language).toBe('auto');
  });

  it('builds the composite "professional" plan and reports unknown text honestly', () => {
    const r = parseIntent('اجعل الفيديو أكثر احترافية');
    expect(r.operations.map((o) => o.type)).toEqual(['enhanceAudio', 'removeSilence', 'applyLook', 'generateSubtitles']);
    const unknown = parseIntent('ما رأيك بالطقس اليوم');
    expect(unknown.operations).toEqual([]);
    expect(unknown.unknownClauses).toEqual(['ما رايك بالطقس اليوم']);
    expect(unknown.confidence).toBe(0);
  });

  it('understands the combined command used in the E2E test', () => {
    const r = parseIntent('احذف أول 10 ثواني، طمس الوجه، حسن الصوت، وأضف ترجمة عربية', { durationMs: 40_000 });
    expect(r.operations.map((o) => o.type)).toEqual(['trimStart', 'blurFaces', 'enhanceAudio', 'generateSubtitles']);
    expect(r.clarifications).toEqual([]);
    expect(r.confidence).toBeGreaterThan(0.85);
  });

  it('recognizes meta commands', () => {
    expect(parseIntent('تراجع').meta).toBe('undo');
    expect(parseIntent('الغي آخر تعديل').meta).toBe('undo');
    expect(parseIntent('undo').meta).toBe('undo');
    expect(parseIntent('redo').meta).toBe('redo');
    expect(parseIntent('ماذا تستطيع أن تفعل؟').meta).toBe('help');
  });
});

describe('parseIntent — English and mixed', () => {
  it('trims, cuts and sets duration', () => {
    expect(parseIntent('delete the first 20 seconds and the last 15').operations).toMatchObject([
      { type: 'trimStart', params: { ms: 20_000 } },
      { type: 'trimEnd', params: { ms: 15_000 } },
    ]);
    expect(first<'trimStart'>('remove the first ten seconds').params.ms).toBe(10_000);
    expect(first<'trimEnd'>('cut 5 seconds off the end').params.ms).toBe(5_000);
    expect(first<'cutRange'>('cut from 2:10 to 2:45').params).toEqual({ startMs: 130_000, endMs: 165_000 });
    expect(first<'cutRange'>('remove everything between 1:00 and 1:30').params).toEqual({ startMs: 60_000, endMs: 90_000 });
    expect(parseIntent('keep only from 0:10 to 0:40', { durationMs: 60_000 }).operations).toMatchObject([
      { type: 'trimEnd', params: { ms: 20_000 } },
      { type: 'trimStart', params: { ms: 10_000 } },
    ]);
    expect(first<'setDuration'>('make the video one minute long').params.targetMs).toBe(60_000);
    expect(first<'setDuration'>('cut it down to a minute').params.targetMs).toBe(60_000);
    expect(first<'setDuration'>('shorten to 45 seconds').params.targetMs).toBe(45_000);
  });

  it('handles privacy, audio, video and subtitles', () => {
    expect(first<'blurFaces'>('blur the face of the person on the right').params.selector).toBe('rightmost');
    expect(first<'blurFaces'>('pixelate all faces').params).toMatchObject({ selector: 'all', kind: 'pixelate' });
    expect(first<'blurFaces'>('hide everyone\'s identity').params.selector).toBe('all');
    expect(types('blur the license plate')).toEqual(['blurText']);
    expect(types('remove the silent parts')).toEqual(['removeSilence']);
    expect(types('tighten the pauses')).toEqual(['removeSilence']);
    expect(first<'enhanceAudio'>('clean up the audio').params.preset).toBe('clean-voice');
    expect(first<'enhanceAudio'>('remove background noise').params.preset).toBe('denoise');
    expect(first<'enhanceAudio'>('normalize the volume').params.preset).toBe('normalize');
    expect(first<'adjustVolume'>('make it louder').params.deltaDb).toBe(6);
    expect(first<'adjustVolume'>('mute the audio').params.mute).toBe(true);
    expect(types('improve the video quality')).toEqual(['enhanceVideo']);
    expect(first<'upscale'>('upscale to 4K').params.targetHeight).toBe(2160);
    expect(types('the footage is shaky')).toEqual(['stabilize']);
    expect(first<'generateSubtitles'>('add arabic subtitles').params.language).toBe('ar');
    expect(first<'generateSubtitles'>('transcribe the speech').params.language).toBe('auto');
    expect(first<'translateSubtitles'>('translate the subtitles to arabic').params.targetLanguage).toBe('ar');
    expect(types('burn in the captions')).toEqual(['burnSubtitles']);
  });

  it('handles aspect, speed, looks and export', () => {
    expect(first<'setAspect'>('make it fit tiktok').params).toMatchObject({ aspect: '9:16', platform: 'tiktok' });
    expect(first<'setAspect'>('convert to vertical').params.aspect).toBe('9:16');
    expect(first<'setAspect'>('make it square').params.aspect).toBe('1:1');
    expect(first<'changeSpeed'>('speed it up 2x').params.factor).toBe(2);
    expect(first<'changeSpeed'>('slow it down to half speed').params.factor).toBe(0.5);
    expect(types('play it backwards')).toEqual(['reverse']);
    expect(first<'freezeFrame'>('freeze frame at 0:05 for 2 seconds').params).toEqual({ atMs: 5_000, durationMs: 2_000 });
    expect(first<'splitAt'>('split at 1:00').params.atMs).toBe(60_000);
    expect(first<'applyLook'>('make it black and white').params.look).toBe('mono');
    expect(first<'applyLook'>('it is too dark').params.adjust).toEqual({ brightness: 0.1 });
    expect(parseIntent('export for youtube').operations).toMatchObject([{ type: 'setAspect', params: { platform: 'youtube' } }, { type: 'export', params: { platform: 'youtube' } }]);
    expect(first<'export'>('export in 4k').params.presetId).toBe('youtube-4k');
    expect(parseIntent('make it more professional').operations.map((o) => o.type)).toEqual(['enhanceAudio', 'removeSilence', 'applyLook', 'generateSubtitles']);
  });

  it('handles mixed-language commands', () => {
    const r = parseIntent('blur the face on the right وحسن الصوت and add arabic subtitles');
    expect(r.language).toBe('mixed');
    expect(r.operations.map((o) => o.type)).toEqual(['blurFaces', 'enhanceAudio', 'generateSubtitles']);
  });
});
