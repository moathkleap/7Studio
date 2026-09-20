import { parseTimeExpression } from '../time';
import { FRACTIONS, readNumber } from './numbers';

export type UnitKind = 'ms' | 's' | 'm' | 'h';

const UNIT_MS: Record<UnitKind, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** Unit words in normalized form (Arabic without hamza/taa-marbuta variants, Latin lower-case). */
const UNIT_WORDS: Record<string, UnitKind> = {
  ms: 'ms',
  ملي: 'ms',
  ثانيه: 's',
  ثواني: 's',
  ثوان: 's',
  ثانيتين: 's',
  ث: 's',
  s: 's',
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  دقيقه: 'm',
  دقايق: 'm',
  دقائق: 'm',
  دقيقتين: 'm',
  د: 'm',
  m: 'm',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
  ساعه: 'h',
  ساعات: 'h',
  ساعتين: 'h',
  h: 'h',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
};

const DUAL_WORDS = new Set(['ثانيتين', 'دقيقتين', 'ساعتين']);
const ARTICLES = new Set(['a', 'an', 'ال', 'the']);
const PREFIXES = ['لل', 'بال', 'وال', 'كال', 'فال', 'ل', 'ب', 'و', 'ف', 'ك', 'ال'];

/** Strips Arabic clitic prefixes (ل، ب، و، ال ...) when the remainder is a known word. */
export function stripPrefix(token: string, known: (t: string) => boolean): string {
  if (known(token)) return token;
  for (const p of PREFIXES) {
    if (token.length > p.length + 1 && token.startsWith(p) && known(token.slice(p.length))) return token.slice(p.length);
  }
  return token;
}

export function unitOf(token: string | undefined): UnitKind | null {
  if (token == null) return null;
  const bare = stripPrefix(token, (t) => UNIT_WORDS[t] != null);
  return UNIT_WORDS[bare] ?? null;
}

export function isTimecode(token: string | undefined): boolean {
  return token != null && /^\d{1,3}:\d{1,2}(?::\d{1,2})?(?:[.,]\d{1,3})?$/.test(token);
}

export interface DurationRead {
  ms: number;
  next: number;
  /** false when the number had no unit and a default (or inherited) unit was applied */
  explicitUnit: boolean;
}

/**
 * Reads a duration starting at tokens[i]: "20 ثانيه", "عشرين ثانيه", "دقيقتين", "نص دقيقه", "دقيقه ونص",
 * "1.5 min", "half a minute", "a minute and a half", "1:30". A bare number takes `defaultUnit` (seconds unless given).
 */
export function readDuration(tokens: string[], i: number, defaultUnit: UnitKind | null = 's'): DurationRead | null {
  const t = tokens[i];
  if (t == null) return null;
  if (isTimecode(t)) {
    const ms = parseTimeExpression(t);
    return ms == null ? null : { ms, next: i + 1, explicitUnit: true };
  }
  const bareT = stripPrefix(t, (x) => UNIT_WORDS[x] != null || FRACTIONS[x] != null || DUAL_WORDS.has(x));
  // dual forms: دقيقتين = two minutes
  if (DUAL_WORDS.has(bareT)) {
    const unit = UNIT_WORDS[bareT]!;
    return withHalf(tokens, { ms: 2 * UNIT_MS[unit], next: i + 1, explicitUnit: true }, unit);
  }
  // fraction + unit: "نص دقيقه", "half a minute", "ربع ساعه"
  if (FRACTIONS[bareT] != null) {
    let j = i + 1;
    if (ARTICLES.has(tokens[j] ?? '') || tokens[j] === 'of') j++;
    if (tokens[j] === 'a' || tokens[j] === 'an') j++;
    const unit = unitOf(tokens[j]);
    if (unit) return { ms: Math.round(FRACTIONS[bareT]! * UNIT_MS[unit]), next: j + 1, explicitUnit: true };
    return null;
  }
  // article + unit: "a minute", "دقيقه" alone (one unit)
  if (ARTICLES.has(t) && unitOf(tokens[i + 1])) {
    const unit = unitOf(tokens[i + 1])!;
    return withHalf(tokens, { ms: UNIT_MS[unit], next: i + 2, explicitUnit: true }, unit);
  }
  const unitAlone = unitOf(t);
  if (unitAlone && !/^\d/.test(t) && (bareT === 'دقيقه' || bareT === 'ثانيه' || bareT === 'ساعه' || bareT === 'minute' || bareT === 'second' || bareT === 'hour')) {
    return withHalf(tokens, { ms: UNIT_MS[unitAlone], next: i + 1, explicitUnit: true }, unitAlone);
  }
  const n = readNumber(tokens, i);
  if (!n) return null;
  const unit = unitOf(tokens[n.next]);
  if (unit) return withHalf(tokens, { ms: Math.round(n.value * UNIT_MS[unit]), next: n.next + 1, explicitUnit: true }, unit);
  if (!defaultUnit) return null;
  // "20 و نص" without a unit is not a duration we trust; bare numbers use the default unit
  return { ms: Math.round(n.value * UNIT_MS[defaultUnit]), next: n.next, explicitUnit: false };
}

/** Adds "ونص" / "and a half" / "وربع" that may follow a duration. */
function withHalf(tokens: string[], read: DurationRead, unit: UnitKind): DurationRead {
  let j = read.next;
  let tok = tokens[j];
  if (tok == null) return read;
  // Arabic: "ونص" is a single token; English: "and a half"
  if (tok.startsWith('و') && FRACTIONS[tok.slice(1)] != null) return { ...read, ms: read.ms + Math.round(FRACTIONS[tok.slice(1)]! * UNIT_MS[unit]), next: j + 1 };
  if (tok === 'و' && tokens[j + 1] != null && FRACTIONS[tokens[j + 1]!] != null) return { ...read, ms: read.ms + Math.round(FRACTIONS[tokens[j + 1]!]! * UNIT_MS[unit]), next: j + 2 };
  if (tok === 'and') {
    j++;
    if (tokens[j] === 'a' || tokens[j] === 'an') j++;
    tok = tokens[j];
    if (tok != null && FRACTIONS[tok] != null) return { ...read, ms: read.ms + Math.round(FRACTIONS[tok]! * UNIT_MS[unit]), next: j + 1 };
  }
  return read;
}

export interface PointRead {
  ms: number;
  next: number;
}

const START_WORDS = new Set(['البدايه', 'بدايه', 'الاول', 'اول', 'start', 'beginning', 'the']);
const END_WORDS = new Set(['النهايه', 'نهايه', 'الاخر', 'اخر', 'end', 'ending']);

/**
 * Reads a time point: "2:10", "الدقيقه 2:10", "الدقيقه 2", "الثانيه 30", "minute 2:10", "second 30",
 * "30 ثانيه" (from the start), "البدايه"/"start" (0), "النهايه"/"end" (the given total duration).
 */
export function readPoint(tokens: string[], i: number, totalMs: number | null): PointRead | null {
  const t = tokens[i];
  if (t == null) return null;
  const bare = stripPrefix(t, (x) => x === 'دقيقه' || x === 'ثانيه' || x === 'ساعه' || START_WORDS.has(x) || END_WORDS.has(x));
  if (bare === 'دقيقه' || bare === 'minute' || bare === 'min') {
    const nextTok = tokens[i + 1];
    if (isTimecode(nextTok)) return { ms: parseTimeExpression(nextTok!)!, next: i + 2 };
    const n = readNumber(tokens, i + 1);
    if (n) {
      // "الدقيقه 2 و 30 ثانيه"
      let ms = Math.round(n.value * 60_000);
      let next = n.next;
      const conj = tokens[next];
      if (conj === 'و' || conj === 'and') {
        const sec = readDuration(tokens, next + 1, null);
        if (sec) {
          ms += sec.ms;
          next = sec.next;
        }
      } else if (conj?.startsWith('و')) {
        const sec = readDuration([conj.slice(1), ...tokens.slice(next + 1)], 0, null);
        if (sec) {
          ms += sec.ms;
          next = next + sec.next;
        }
      }
      return { ms, next };
    }
    return null;
  }
  if (bare === 'ثانيه' || bare === 'second' || bare === 'sec') {
    const n = readNumber(tokens, i + 1);
    if (n) return { ms: Math.round(n.value * 1000), next: n.next };
    return null;
  }
  if (bare === 'ساعه' || bare === 'hour') {
    const n = readNumber(tokens, i + 1);
    if (n) return { ms: Math.round(n.value * 3_600_000), next: n.next };
    return null;
  }
  if (START_WORDS.has(bare) && bare !== 'the') return { ms: 0, next: i + 1 };
  if (bare === 'the' && (START_WORDS.has(tokens[i + 1] ?? '') || END_WORDS.has(tokens[i + 1] ?? ''))) return readPoint(tokens, i + 1, totalMs);
  if (END_WORDS.has(bare)) return totalMs == null ? null : { ms: totalMs, next: i + 1 };
  const d = readDuration(tokens, i, 's');
  if (d) return { ms: d.ms, next: d.next };
  return null;
}

const RANGE_STARTS = new Set(['من', 'from', 'between', 'بين']);
const RANGE_CONNECTORS = new Set(['الي', 'إلي', 'ل', 'لـ', 'حتي', 'لغايه', 'لحد', 'to', 'till', 'until', 'through', '-', 'و', 'and', 'لين']);

export interface RangeRead {
  startMs: number;
  endMs: number;
  /** token span [from, to) */
  from: number;
  to: number;
}

/** Finds "من A الي B" / "from A to B" / "between A and B" / "A - B" anywhere in the tokens. */
export function findRange(tokens: string[], totalMs: number | null): RangeRead | null {
  for (let i = 0; i < tokens.length; i++) {
    const startWord = RANGE_STARTS.has(tokens[i]!);
    const a = readPoint(tokens, startWord ? i + 1 : i, totalMs);
    if (!a) continue;
    const j = a.next;
    let connector = tokens[j];
    if (connector == null) continue;
    // "الي" may be attached as a prefix: "لل2:45" is rare; handle "و" attached to a timecode ("و2:45")
    let bare = connector;
    if (!RANGE_CONNECTORS.has(bare) && bare.length > 2 && (bare.startsWith('ل') || bare.startsWith('و'))) {
      const rest = bare.replace(/^(لل|ل|و)/, '');
      if (rest && (isTimecode(rest) || /^\d/.test(rest) || readPoint([rest, ...tokens.slice(j + 1)], 0, totalMs))) {
        tokens = [...tokens.slice(0, j), bare[0]!, rest, ...tokens.slice(j + 1)];
        bare = bare[0]!;
        connector = bare;
      }
    }
    if (!RANGE_CONNECTORS.has(bare)) continue;
    const b = readPoint(tokens, j + 1, totalMs);
    if (!b) continue;
    if (b.ms > a.ms) return { startMs: a.ms, endMs: b.ms, from: startWord ? i : i, to: b.next };
  }
  return null;
}

/** First duration found in the tokens (used by matchers that only need "how long"). */
export function findDuration(tokens: string[], defaultUnit: UnitKind | null = 's'): DurationRead & { at: number } | null {
  for (let i = 0; i < tokens.length; i++) {
    const d = readDuration(tokens, i, defaultUnit);
    if (d && (d.explicitUnit || defaultUnit)) return { ...d, at: i };
  }
  return null;
}
