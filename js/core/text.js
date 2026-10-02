/**
 * Persian-aware text utilities shared by the browser app and the Node tools.
 * Pure functions only — no DOM, no globals.
 */

const ARABIC_TO_PERSIAN = new Map([
  ['ي', 'ی'], ['ى', 'ی'], ['ك', 'ک'], ['ة', 'ه'], ['ۀ', 'ه'], ['ؤ', 'و'],
  ['إ', 'ا'], ['أ', 'ا'], ['ٱ', 'ا'], ['آ', 'آ'],
]);

const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

// Harakat, tatweel and other marks that never change meaning for search.
const MARKS = /[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/g;
const SEPARATORS = /[\u200C\u200D\u00A0\-_/\\|]+/g;
const PUNCTUATION = /[.,،؛;:!?؟«»"'()\[\]{}<>…•*+=~`^%$#@&]+/g;

/** Converts Persian and Arabic-Indic digits to ASCII digits. */
export function toLatinDigits(input) {
  let out = '';
  for (const ch of String(input)) {
    const p = DIGITS.indexOf(ch);
    const a = ARABIC_DIGITS.indexOf(ch);
    out += p >= 0 ? String(p) : a >= 0 ? String(a) : ch;
  }
  return out;
}

/** Converts ASCII digits to Persian digits for display. */
export function toPersianDigits(input) {
  return String(input).replace(/\d/g, (d) => DIGITS[Number(d)]);
}

/**
 * Normalizes text for matching: unifies Arabic/Persian letters, removes
 * diacritics, maps ZWNJ and hyphens to spaces, lowercases Latin text.
 * Punctuation is kept unless `stripPunctuation` is true, because clause
 * boundaries matter to the intent parser.
 */
export function normalize(input, { stripPunctuation = false } = {}) {
  if (input == null) return '';
  let s = toLatinDigits(String(input)).normalize('NFC');
  s = s.replace(MARKS, '');
  s = s.replace(/[يىكةۀؤإأٱ]/g, (ch) => ARABIC_TO_PERSIAN.get(ch) ?? ch);
  // ZWNJ before an inflectional suffix joins (کتاب‌ها → کتابها); elsewhere it separates words.
  s = s.replace(/\u200C(?=(ها|های|هایی|تر|ترین|ام|ات|اش|ای|ایی|ی|یم|ید|اند)(?![\u0600-\u06FF]))/g, '');
  s = s.replace(SEPARATORS, ' ');
  if (stripPunctuation) s = s.replace(PUNCTUATION, ' ');
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Normalized tokens with punctuation removed. */
export function tokenize(input) {
  const s = normalize(input, { stripPunctuation: true });
  return s ? s.split(' ') : [];
}

/** Persian inflectional suffixes allowed after a matched stem. */
const SUFFIXES = [
  '', 'ی', 'ای', 'یی', 'ها', 'های', 'هایی', 'هاش', 'تر', 'ترین', 'تری', 'ه', 'ش', 'م', 'ت',
  'ام', 'ات', 'اش', 'مون', 'تون', 'شون', 'ن', 'و', 'رو', 'یه', 'ایه', 's', 'es', 'y', 'ish',
];

/**
 * True when `token` equals `stem` or is `stem` followed by a known suffix.
 * This keeps «تاریکی» matching «تاریک» without letting «سرد» match «سردار».
 */
export function stemMatches(token, stem, exact = false) {
  if (token === stem) return true;
  if (exact || !token.startsWith(stem)) return false;
  return SUFFIXES.includes(token.slice(stem.length));
}

/** Levenshtein distance with an early exit once `max` is exceeded. */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Stable slug suitable for ids: latin letters, digits and dashes. */
export function slugify(input) {
  return normalize(input, { stripPunctuation: true })
    .replace(/[^a-z0-9\u0600-\u06FF ]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Splits «عنوان فارسی (English Title)» into its aliases. */
export function splitAliases(label) {
  const out = new Set();
  const raw = String(label ?? '');
  const inParens = [...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  const outside = raw.replace(/\([^)]*\)/g, ' ');
  for (const part of [outside, ...inParens]) {
    for (const piece of part.split(/[/|،,:؛]/)) {
      const n = normalize(piece, { stripPunctuation: true });
      if (n.length >= 2) out.add(n);
    }
  }
  return [...out];
}
