import { describe, expect, it } from 'vitest';
import { BriefSchema } from './types';
import { buildScript, estimateNarrationMs, reviewScript, splitBeats } from './builder';

const brief = (over: Record<string, unknown> = {}) => BriefSchema.parse({ idea: 'قهوة الصباح تمنحك طاقة. اشترِ من متجرنا. جودة عالية وسعر مناسب.', language: 'ar', durationSec: 20, ...over });

describe('creator script builder', () => {
  it('splits beats across Arabic and Latin punctuation', () => {
    expect(splitBeats('واحد. اثنان، ثلاثة؟ four! five')).toEqual(['واحد', 'اثنان', 'ثلاثة', 'four', 'five']);
  });

  it('estimates narration duration from word count', () => {
    expect(estimateNarrationMs('')).toBe(2000);
    expect(estimateNarrationMs('كلمة')).toBeGreaterThanOrEqual(1800);
    expect(estimateNarrationMs('a '.repeat(150).trim())).toBeGreaterThan(50_000);
  });

  it('builds a hook + body + CTA script scaled to the target duration', () => {
    const s = buildScript(brief());
    expect(s.title.length).toBeGreaterThan(0);
    // hook + 3 beats + cta = 5 scenes
    expect(s.scenes).toHaveLength(5);
    expect(s.scenes[0]!.heading).toBe('مقدمة');
    expect(s.scenes[s.scenes.length - 1]!.heading).toBe('دعوة للتفاعل');
    expect(s.scenes.every((sc) => sc.durationMs >= 1500)).toBe(true);
    const total = s.scenes.reduce((a, sc) => a + sc.durationMs, 0);
    // within 40% of the 20s target after scaling
    expect(Math.abs(total - 20_000) / 20_000).toBeLessThan(0.4);
    expect(s.scenes.every((sc, i) => sc.index === i)).toBe(true);
  });

  it('links a named character into the scenes that mention them and writes an English prompt', () => {
    const characters = [{ id: 'chr_1', name: 'سارة', bible: { age: '25', gender: 'female' as const, appearance: 'smiling', hair: 'black', clothing: 'red dress', personality: '', voice: { engine: 'espeak' as const, voice: '', rate: 165 } }, referenceImages: [], hasEmbedding: false }];
    const s = buildScript(BriefSchema.parse({ idea: 'سارة تشرب القهوة. المتجر مفتوح.', language: 'ar', durationSec: 12 }), characters);
    const withChar = s.scenes.find((sc) => sc.characterIds.includes('chr_1'));
    expect(withChar).toBeTruthy();
    expect(withChar!.prompt).toContain('سارة');
    expect(withChar!.prompt).toContain('red dress');
    expect(withChar!.negativePrompt).toContain('blurry');
  });

  it('reviews a script and reports empty narration, duration drift and inconsistency honestly', () => {
    const b = brief({ durationSec: 20 });
    const s = buildScript(b);
    const clean = reviewScript(b, s.scenes.map((sc) => ({ id: sc.id, scene: sc, voiceMs: null, consistency: null, status: 'draft' })));
    expect(clean.filter((i) => i.severity === 'error')).toHaveLength(0);
    // inject an empty-narration scene and an inconsistent character
    const scenes = s.scenes.map((sc, i) => ({ id: sc.id, scene: i === 1 ? { ...sc, narration: '', dialogue: [] } : sc, voiceMs: null, consistency: i === 2 ? { ok: false } : null, status: 'draft' }));
    const issues = reviewScript(b, scenes);
    expect(issues.some((i) => i.code === 'empty-narration')).toBe(true);
    expect(issues.some((i) => i.code === 'inconsistent-character')).toBe(true);
  });

  it('produces an English builder for English briefs', () => {
    const s = buildScript(BriefSchema.parse({ idea: 'Morning coffee gives you energy. Buy from our store.', language: 'en', durationSec: 15 }));
    expect(s.scenes[0]!.heading).toBe('Hook');
    expect(s.logline.toLowerCase()).toContain('video about');
  });
});
