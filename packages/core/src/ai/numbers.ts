import { normalizeDigits } from '../time';

/**
 * Text normalization shared by the intent parser: Arabic-Indic digits → ASCII, diacritics/tatweel removed,
 * hamza/taa-marbuta/alef-maqsura variants unified, Latin lower-cased, spaces inserted between digits and Arabic letters.
 * The normalized text is only used for matching; the original text is kept for display.
 */
export function normalizeText(text: string): string {
  return normalizeDigits(text)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[؟?!]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/(\d)(?=[؀-ۿ])/g, '$1 ')
    .replace(/([؀-ۿ])(?=\d)/g, '$1 ')
    .replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 - $2')
    .replace(/([a-z])-([a-z])/gi, '$1 $2')
    .replace(/[×]/g, 'x')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const AR_UNITS: Record<string, number> = {
  صفر: 0,
  واحد: 1,
  واحده: 1,
  وحده: 1,
  اثنين: 2,
  اثنان: 2,
  اثنتين: 2,
  ثنتين: 2,
  تنين: 2,
  ثلاث: 3,
  ثلاثه: 3,
  تلات: 3,
  تلاته: 3,
  اربع: 4,
  اربعه: 4,
  خمس: 5,
  خمسه: 5,
  ست: 6,
  سته: 6,
  سبع: 7,
  سبعه: 7,
  ثمان: 8,
  ثماني: 8,
  ثمانيه: 8,
  تمان: 8,
  تمانيه: 8,
  تسع: 9,
  تسعه: 9,
  عشر: 10,
  عشره: 10,
};

const AR_TEENS: Record<string, number> = {
  'احد عشر': 11,
  'احدعشر': 11,
  'اثنا عشر': 12,
  'اثني عشر': 12,
  'اثنعش': 12,
  'ثلاثه عشر': 13,
  'ثلاث عشر': 13,
  'اربعه عشر': 14,
  'اربع عشر': 14,
  'خمسه عشر': 15,
  'خمس عشر': 15,
  'سته عشر': 16,
  'ست عشر': 16,
  'سبعه عشر': 17,
  'سبع عشر': 17,
  'ثمانيه عشر': 18,
  'ثمان عشر': 18,
  'تسعه عشر': 19,
  'تسع عشر': 19,
};

const AR_TENS: Record<string, number> = {
  عشرين: 20,
  ثلاثين: 30,
  تلاتين: 30,
  اربعين: 40,
  خمسين: 50,
  ستين: 60,
  سبعين: 70,
  ثمانين: 80,
  تمانين: 80,
  تسعين: 90,
};

const AR_HUNDREDS: Record<string, number> = { مئه: 100, مائه: 100, ميه: 100, ميت: 100, مئتين: 200, ميتين: 200 };

const EN_UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export const FRACTIONS: Record<string, number> = { نص: 0.5, نصف: 0.5, ربع: 0.25, ثلث: 1 / 3, half: 0.5, quarter: 0.25, third: 1 / 3 };

export interface NumberRead {
  value: number;
  /** Index of the first token after the number. */
  next: number;
  words: boolean;
}

function digitValue(token: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(token)) return null;
  return Number(token.replace(',', '.'));
}

/**
 * Reads a number at tokens[i]: digits ("20", "1.5") or number words in Arabic or English
 * ("عشرين", "خمسه وعشرين", "مية وخمسين", "twenty five", "one hundred twenty").
 */
export function readNumber(tokens: string[], i: number): NumberRead | null {
  const t = tokens[i];
  if (t == null) return null;
  const d = digitValue(t);
  if (d != null) return { value: d, next: i + 1, words: false };
  // Arabic teens are two tokens
  const two = `${t} ${tokens[i + 1] ?? ''}`.trim();
  if (AR_TEENS[two] != null) return { value: AR_TEENS[two]!, next: i + 2, words: true };
  if (AR_TEENS[t] != null) return { value: AR_TEENS[t]!, next: i + 1, words: true };
  const readWord = (tok: string | undefined): { kind: 'unit' | 'tens' | 'hundred'; value: number } | null => {
    if (tok == null) return null;
    const bare = tok.replace(/^و/, '');
    if (AR_HUNDREDS[tok] != null) return { kind: 'hundred', value: AR_HUNDREDS[tok]! };
    if (AR_UNITS[tok] != null) return { kind: 'unit', value: AR_UNITS[tok]! };
    if (AR_TENS[tok] != null) return { kind: 'tens', value: AR_TENS[tok]! };
    if (bare !== tok) {
      if (AR_HUNDREDS[bare] != null) return { kind: 'hundred', value: AR_HUNDREDS[bare]! };
      if (AR_UNITS[bare] != null) return { kind: 'unit', value: AR_UNITS[bare]! };
      if (AR_TENS[bare] != null) return { kind: 'tens', value: AR_TENS[bare]! };
    }
    if (EN_UNITS[tok] != null) return { kind: 'unit', value: EN_UNITS[tok]! };
    if (EN_TENS[tok] != null) return { kind: 'tens', value: EN_TENS[tok]! };
    if (tok === 'hundred') return { kind: 'hundred', value: 100 };
    return null;
  };
  const first = readWord(t);
  if (!first) return null;
  let value = 0;
  let j = i;
  let sawUnit = false;
  let sawTens = false;
  for (;;) {
    const tok = tokens[j];
    if (tok === 'و' || tok === 'and') {
      const after = readWord(tokens[j + 1]);
      if (!after) break;
      j++;
      continue;
    }
    const w = readWord(tok);
    if (!w) break;
    if (w.kind === 'hundred') {
      value = w.value === 100 ? (sawUnit && value > 0 ? value * 100 : value + 100) : value + w.value;
      sawUnit = false;
      sawTens = false;
    } else if (w.kind === 'tens') {
      if (sawTens) break;
      value += w.value;
      sawTens = true;
    } else {
      if (sawUnit && !sawTens && value % 100 !== 0) break;
      value += w.value;
      sawUnit = true;
    }
    j++;
  }
  if (j === i) return null;
  return { value, next: j, words: true };
}

/** Returns the numeric value of a standalone number word (used by speed factors like "مرتين"/"twice"). */
export function numberWord(token: string): number | null {
  if (AR_UNITS[token] != null) return AR_UNITS[token]!;
  if (AR_TENS[token] != null) return AR_TENS[token]!;
  if (EN_UNITS[token] != null) return EN_UNITS[token]!;
  if (EN_TENS[token] != null) return EN_TENS[token]!;
  return digitValue(token);
}
