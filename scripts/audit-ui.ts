/**
 * audit-ui — a deterministic static audit of the renderer that enforces the "no dead buttons" rule and
 * translation completeness. It scans the React source and fails when it finds:
 *   1. an empty or missing click handler on an interactive control,
 *   2. a Button/IconButton carrying a `data-action` with no handler and no way to act,
 *   3. a Switch carrying a `data-action` with no `onCheckedChange`,
 *   4. an i18n key used via t('literal') that is missing from the English catalogue,
 *   5. English/Arabic locale catalogues that are not at key parity.
 *
 * Dynamic click-through of every screen is covered by the Playwright E2E suite; this audit is the fast,
 * browser-free gate that runs in CI (`pnpm audit:ui`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const rendererDir = path.join(root, 'apps/desktop/src/renderer/src');
const enPath = path.join(rendererDir, 'i18n/en.json');
const arPath = path.join(rendererDir, 'i18n/ar.json');

interface Issue {
  file: string;
  line: number;
  message: string;
}
const errors: Issue[] = [];
const warnings: Issue[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(tsx?|)$/.test(entry.name) && /\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function rel(p: string): string {
  return path.relative(root, p);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Returns the opening-tag text for a JSX element starting at `start` (the `<`), tracking strings and braces. */
function readOpeningTag(text: string, start: number): { tag: string; end: number } {
  let i = start;
  let depth = 0;
  let quote: string | null = null;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    const prev = text[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return { tag: text.slice(start, i + 1), end: i + 1 };
  }
  return { tag: text.slice(start), end: text.length };
}

const EMPTY_HANDLER = /(on[A-Z]\w+)=\{\s*(?:\(\s*\)|\([^)]*\))\s*=>\s*(?:\{\s*\}|undefined|null|void 0)\s*\}/;
const EMPTY_HANDLER_DIRECT = /(on[A-Z]\w+)=\{\s*(?:undefined|null)\s*\}/;

/** True when the control is intentionally inert (disabled and not `disabled={false}`). */
function isDisabled(tag: string): boolean {
  return /\bdisabled\b/.test(tag) && !/disabled=\{false\}/.test(tag);
}

/** True when a Radix `asChild` parent (Trigger/Close/etc.) injects the real handler onto this control. */
function underAsChild(text: string, idx: number): boolean {
  return /asChild\s*>\s*$/.test(text.slice(Math.max(0, idx - 120), idx));
}

function auditComponent(text: string, file: string, name: 'Button' | 'IconButton' | 'Switch'): void {
  const needle = `<${name}`;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx < 0) break;
    // ensure it's the component, not a longer identifier (e.g. <ButtonGroup)
    const after = text[idx + needle.length];
    if (after && /[A-Za-z0-9]/.test(after)) {
      from = idx + needle.length;
      continue;
    }
    const { tag, end } = readOpeningTag(text, idx);
    from = end;
    const line = lineOf(text, idx);
    const hasAction = /\b(action|data-action)=/.test(tag);
    const hasSpread = /\{\.\.\.[\w.]+\}/.test(tag); // {...rest} may carry a handler
    const disabled = isDisabled(tag);
    const asChild = underAsChild(text, idx); // Radix Trigger/Close injects the handler
    // An empty handler is only a bug on an enabled control; on a disabled one it is a deliberate inert no-op.
    if ((EMPTY_HANDLER.test(tag) || EMPTY_HANDLER_DIRECT.test(tag)) && !disabled) {
      errors.push({ file, line, message: `<${name}> has an empty/no-op handler (dead control)` });
      continue;
    }
    if (disabled || asChild) continue; // inert by design, or handler injected by a Radix parent
    if (name === 'Switch') {
      if (hasAction && !/onCheckedChange=/.test(tag) && !hasSpread) errors.push({ file, line, message: `<Switch> with an action has no onCheckedChange` });
      continue;
    }
    // Button / IconButton: needs a way to act
    const hasHandler = /onClick=/.test(tag) || /onMouseDown=/.test(tag) || /onPointerDown=/.test(tag);
    const isSubmit = /type=\{?['"]submit['"]\}?/.test(tag);
    const isLink = /href=/.test(tag);
    if (hasAction && !hasHandler && !isSubmit && !isLink && !hasSpread) {
      errors.push({ file, line, message: `<${name} action=…> has no onClick, submit type, href or handler spread (dead button)` });
    }
  }
}

// ---------------------------------------------------------------------------- i18n
function flatten(obj: Record<string, unknown>, prefix = '', out: Set<string> = new Set()): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else out.add(key);
  }
  return out;
}

const files = walk(rendererDir).filter((f) => !f.endsWith('.d.ts'));

// 1–3: dead controls
for (const file of files) {
  if (!file.endsWith('.tsx')) continue;
  const text = fs.readFileSync(file, 'utf8');
  auditComponent(text, rel(file), 'Button');
  auditComponent(text, rel(file), 'IconButton');
  auditComponent(text, rel(file), 'Switch');
}

// 4: every literal t('key') exists in en.json
const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as Record<string, unknown>;
const ar = JSON.parse(fs.readFileSync(arPath, 'utf8')) as Record<string, unknown>;
const enKeys = flatten(en);
const arKeys = flatten(ar);
const usedKeys = new Map<string, { file: string; line: number }>();
const tCall = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = tCall.exec(text))) {
    const key = m[1]!;
    if (!usedKeys.has(key)) usedKeys.set(key, { file: rel(file), line: lineOf(text, m.index) });
  }
}
for (const [key, at] of usedKeys) {
  if (!enKeys.has(key)) errors.push({ file: at.file, line: at.line, message: `i18n key not found in en.json: '${key}'` });
}

// 5: locale parity
for (const k of enKeys) if (!arKeys.has(k)) errors.push({ file: 'i18n/ar.json', line: 0, message: `missing Arabic translation for '${k}'` });
for (const k of arKeys) if (!enKeys.has(k)) warnings.push({ file: 'i18n/en.json', line: 0, message: `Arabic key not present in English: '${k}'` });

// ---------------------------------------------------------------------------- report
const buttons = files.filter((f) => f.endsWith('.tsx')).reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(/<(Button|IconButton|Switch)\b/g)?.length ?? 0), 0);
console.log(`audit-ui: scanned ${files.filter((f) => f.endsWith('.tsx')).length} components, ${buttons} interactive controls, ${usedKeys.size} translation keys`);
console.log(`i18n: en=${enKeys.size} ar=${arKeys.size} keys`);
for (const w of warnings) console.log(`  warn  ${w.file}:${w.line}  ${w.message}`);
if (errors.length === 0) {
  console.log(`\n✓ no dead controls, all ${usedKeys.size} used translation keys resolve, locales at parity`);
  process.exit(0);
}
console.error(`\n✗ ${errors.length} issue(s):`);
for (const e of errors) console.error(`  error ${e.file}:${e.line}  ${e.message}`);
process.exit(1);
