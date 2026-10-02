/**
 * Free-text intent parser for Persian (and casual English) reading requests.
 *
 * Input:  «یه چیز تاریک ولی نه خیلی ترسناک، زیر ۴۰۰ صفحه، شبیه تل‌ماسه»
 * Output: a list of signals the recommender understands, each with the span
 *         of text it came from, so the UI can show what was understood and let
 *         the reader correct it.
 *
 * It is deliberately rule-based: predictable, explainable, instant, offline,
 * and the vocabulary lives in data/vocab.json so editors can extend it.
 */
import { normalize, stemMatches, splitAliases } from '../core/text.js';
import { READER_STATES } from './states.js';

/** Built-in phrases for dimensions that are not part of vocab.json. */
const DIMENSION_LEXICON = [
  ['length', 'short', ['کوتاه', 'جمع و جور', 'جمعوجور', 'کم حجم', 'کم صفحه', 'نازک', 'یه شبه', 'یک شبه', 'یه نشست', 'آخر هفته', 'زود تموم', 'short']],
  ['length', 'long', ['طولانی', 'قطور', 'حجیم', 'مفصل', 'چند جلدی', 'کلفت', 'غرق شم', 'غرق بشم', '=بلند', 'long']],
  ['pace', 'fast', ['سریع', 'تند', 'پرکشش', 'پر کشش', '=کشش', 'میخکوب', 'زمین نذارم', 'نتونم زمین بذارم', 'ریتم تند', 'fast paced', 'page turner']],
  ['pace', 'slow', ['آهسته', 'ریتم آرام', 'ریتم کند', 'آروم پیش بره', 'با حوصله', 'slow burn', '=کند']],
  ['darkness', 'light', ['روشن', 'لطیف', 'ملایم', 'بی خشونت', 'شاد', 'شادی', 'سبک دل', 'wholesome']],
  ['complexity', 'easy', ['=سبک', 'ساده', '=روان', 'روون', 'راحت', 'سرگرم کننده', 'سرگرمی', 'خوشخوان', 'خوش خوان', 'easy read']],
  ['complexity', 'deep', ['سنگین', 'پیچیده', 'چالشی', 'چالش برانگیز', 'ادبی', 'لایه لایه', 'challenging']],
  ['audience', 'ya', ['نوجوان', 'نوجوون', '=بچه', 'بچم', 'پسرم', 'دخترم', 'کودک', 'young adult', '=ya']],
  ['audience', 'adult', ['بزرگسال', 'بزرگسالانه']],
  ['translated', 'yes', ['ترجمه', 'ترجمه شده', 'به فارسی', '=فارسی']],
];

const PRE_NEGATORS = new Set(['بدون', 'بی', 'نه', 'غیر', 'جز', 'بجز', 'منهای', 'هیچ', 'نمی', 'نمیخوام', 'not', 'no', 'without']);
const POST_NEGATORS = new Set([
  'نباشه', 'نباشد', 'نباشن', 'نباشند', 'نداشته', 'نداره', 'ندارد', 'ندارم', 'نداشتم', 'نمیخوام', 'نمیخواهم', 'نخوام',
  'نه', 'متنفرم', 'بدم', 'بیزارم', 'نکنه', 'نیومد', 'نمیاد', 'نمی', 'نیست', 'nope',
]);
const SOFTENERS = new Set(['خیلی', 'زیاد', 'چندان', 'اونقدر', 'آنقدر', 'چندون', 'too', 'very']);
const INTENSIFIERS = new Set(['خیلی', 'شدیدا', 'واقعا', 'حسابی', 'بشدت', 'کاملا', 'حتما', 'خفن', 'اصلا', 'really', 'very']);
const DIMINISHERS = new Set(['یکم', 'کمی', 'نسبتا', 'یخورده', 'ذره', 'somewhat', 'bit']);
const REFERENCE_CUES = new Set(['مثل', 'شبیه', 'فیلم', 'سریال', 'هوای', 'سبک', 'مثه', 'عین', 'like', 'film', 'movie']);
const CLAUSE_BREAKS = new Set(['ولی', 'اما', 'ولیکن', 'but', 'however']);
const STOPWORDS = new Set(['یه', 'یک', 'کتاب', 'میخوام', 'می', 'خوام', 'که', 'و', 'با', 'از', 'به', 'در', 'رو', 'را', 'باشه', 'چیز', 'داستان', 'رمان', 'من', 'برام', 'برای', 'دارم', 'هست', 'باشد', 'مثل', 'شبیه', 'ای', 'این', 'اون', 'یا', 'هم', 'تا', 'the', 'a', 'book', 'like']);

const NUMBER_RULES = [
  { re: /(زیر|کمتر از|کمتر|حداکثر|نهایتا|ماکزیمم|تا|under|max)\s*(\d{2,4})\s*(صفحه|ص|pages?)?/, kind: 'max' },
  { re: /(بالای|بیشتر از|بیش از|حداقل|over|min)\s*(\d{2,4})\s*(صفحه|ص|pages?)?/, kind: 'min' },
  { re: /(\d{2,4})\s*(صفحه|pages)/, kind: 'around' },
  { re: /(\d{1,2})\s*ساعت/, kind: 'hours' },
  { re: /(?:^|\s)(یک|یه|دو|سه|چهار|پنج|شش|هفت|هشت|ده)\s*ساعت/, kind: 'hours', words: true },
];
const NUMBER_WORDS = { یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, ده: 10 };

function aliasTokens(text) {
  const exact = text.startsWith('=');
  const t = normalize(exact ? text.slice(1) : text, { stripPunctuation: true });
  return { tokens: t ? t.split(' ') : [], exact };
}

/** Compiles vocab + built-in lexicon into a flat, longest-first matcher list. */
export function compileLexicon(vocab) {
  const entries = [];
  const add = (kind, id, label, tokens, exact) => { if (tokens.length) entries.push({ kind, id, label, tokens, exact }); };
  for (const [kind, group] of [['mood', 'moods'], ['genre', 'genres'], ['theme', 'themes'], ['warning', 'warnings'], ['format', 'formats']]) {
    for (const e of vocab[group].list) {
      for (const a of e.aliases) add(kind, e.id, e.label, a.text.split(' '), a.exact);
      add(kind, e.id, e.label, normalize(e.label, { stripPunctuation: true }).split(' '), false);
    }
  }
  for (const [kind, id, words] of DIMENSION_LEXICON) {
    for (const w of words) { const { tokens, exact } = aliasTokens(w); add(kind, id, null, tokens, exact); }
  }
  entries.sort((a, b) => b.tokens.length - a.tokens.length);
  return entries;
}

function matchAt(tokens, i, pattern, exact) {
  if (i + pattern.length > tokens.length) return false;
  for (let k = 0; k < pattern.length; k++) {
    const p = pattern[k];
    if (!stemMatches(tokens[i + k], p, exact || p.length < 3)) return false;
  }
  return true;
}

/** Splits normalized text into clauses of tokens with character offsets. */
function clauses(text) {
  const out = [];
  let current = [];
  const re = /[^\s.,،؛;:!?؟]+|[.,،؛;:!?؟]/g;
  let m;
  while ((m = re.exec(text))) {
    const tok = m[0];
    if (/^[.,،؛;:!?؟]$/.test(tok) || CLAUSE_BREAKS.has(tok)) {
      if (current.length) out.push(current);
      current = [];
    } else current.push({ t: tok, start: m.index, end: m.index + tok.length });
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Parses free text.
 * @param {string} input
 * @param {{lexicon: object[], books: object[]}} ctx
 * @returns {{ signals: object[], states: {id:string}[], text: string }}
 */
export function parseIntent(input, { lexicon, books = [], strategies = {} }) {
  const text = normalize(input);
  const signals = [];
  const states = [];
  if (!text) return { signals, states, text };

  // 1) Reader states first; their spans are masked so «غمگینم» is not also «a sad book».
  // Punctuation becomes spaces (same length) so «خسته‌ام،» still ends a word.
  let masked = text;
  let bare = text.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  for (const [id, def] of Object.entries(READER_STATES)) {
    for (const re of def.patterns) {
      const m = bare.match(re);
      if (m) {
        states.push({ id, span: [m.index, m.index + m[0].length] });
        const blank = (str) => str.slice(0, m.index) + ' '.repeat(m[0].length) + str.slice(m.index + m[0].length);
        masked = blank(masked); bare = blank(bare);
        break;
      }
    }
  }

  // 2) Numbers (pages / hours).
  let pagesFound = false;
  for (const rule of NUMBER_RULES) {
    if (pagesFound && rule.kind !== 'hours') continue;
    if (rule.kind === 'hours' && signals.some((x) => x.note)) continue;
    const m = masked.match(rule.re);
    if (!m) continue;
    const n = rule.words ? NUMBER_WORDS[m[1]] : Number(rule.kind === 'max' || rule.kind === 'min' ? m[2] : m[1]);
    if (!Number.isFinite(n)) continue;
    if (rule.kind === 'hours') signals.push({ kind: 'pages', id: `max:${Math.max(n * 45, 220)}`, polarity: 1, strength: 0.8, hard: false, note: `${n} ساعت` });
    else if (rule.kind === 'around') signals.push({ kind: 'pages', id: `around:${n}`, polarity: 1, strength: 1 });
    else if (n >= 50) signals.push({ kind: 'pages', id: `${rule.kind}:${n}`, polarity: 1, strength: 1, hard: true });
    pagesFound = rule.kind !== 'hours';
    masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
  }

  // 3) Lexicon + book/film/author references, clause by clause.
  for (const clause of clauses(masked)) {
    const toks = clause.map((c) => c.t);
    const hits = [];
    const used = new Array(toks.length).fill(false);
    const claim = (i, len, hit) => {
      for (let k = i; k < i + len; k++) if (used[k]) return;
      for (let k = i; k < i + len; k++) used[k] = true;
      hits.push({ ...hit, i, len });
    };

    // Book titles and films first: they are the most specific references.
    for (const book of books) {
      for (const alias of book._aliases) {
        const pat = alias.split(' ');
        for (let i = 0; i < toks.length; i++) {
          if (matchAt(toks, i, pat, true) || (pat.length > 1 && toks[i] === pat.join(''))) {
            claim(i, toks[i] === pat.join('') ? 1 : pat.length, { kind: 'seed', id: book.id, label: book.title });
          }
        }
      }
    }
    for (const book of books) {
      for (const alias of book._films) {
        const pat = alias.split(' ');
        for (let i = 0; i < toks.length; i++) {
          if (used[i] || !matchAt(toks, i, pat, true)) continue;
          // One-word film titles are often ordinary words («ورود», «ماه»); require a cue.
          const cued = toks.slice(Math.max(0, i - 3), i).some((t) => REFERENCE_CUES.has(t));
          if (pat.length > 1 || cued || /^[a-z0-9]+$/.test(alias)) claim(i, pat.length, { kind: 'film', id: alias, label: alias });
        }
      }
    }
    for (let i = 0; i < toks.length; i++) {
      if (used[i]) continue;
      for (const e of lexicon) {
        if (matchAt(toks, i, e.tokens, e.exact)) { claim(i, e.tokens.length, { kind: e.kind, id: e.id, label: e.label }); break; }
      }
    }
    // Author surnames (≥4 letters) for «یه چیز از لوگویین».
    for (let i = 0; i < toks.length; i++) {
      if (used[i] || toks[i].length < 4 || STOPWORDS.has(toks[i])) continue;
      const match = books.find((b) => normalize(`${b.author} ${b.author_en}`, { stripPunctuation: true }).split(' ').includes(toks[i]));
      if (match) claim(i, 1, { kind: 'author', id: match.author, label: match.author });
    }

    hits.sort((a, b) => a.i - b.i);
    for (let h = 0; h < hits.length; h++) {
      const hit = hits[h];
      const prevEnd = h > 0 ? hits[h - 1].i + hits[h - 1].len : 0;
      const nextStart = h < hits.length - 1 ? hits[h + 1].i : toks.length;
      const before = toks.slice(Math.max(prevEnd, hit.i - 3), hit.i);
      const after = toks.slice(hit.i + hit.len, Math.min(nextStart, hit.i + hit.len + 4));
      const window = [...before, ...after];

      const negated = before.some((t) => PRE_NEGATORS.has(t)) || after.some((t) => POST_NEGATORS.has(t) || t.startsWith('نمی'));
      const softened = negated && window.some((t) => SOFTENERS.has(t));
      let strength = 1;
      if (!negated && before.some((t) => INTENSIFIERS.has(t))) strength = 1.4;
      if (window.some((t) => DIMINISHERS.has(t)) || window.includes('کم') && before.includes('یه')) strength = 0.6;
      if (negated && window.includes('اصلا')) strength = 1.4;
      if (softened) strength = 0.5;

      const start = clause[hit.i].start;
      const end = clause[hit.i + hit.len - 1].end;
      const base = { span: [start, end], source: 'text', label: hit.label };

      if (hit.kind === 'film') {
        signals.push({ ...base, kind: 'film', id: hit.id, polarity: negated ? -1 : 1, strength: 1, label: displayFilm(books, hit.id) });
        continue;
      }
      if (hit.kind === 'warning') { signals.push({ ...base, kind: 'warning', id: hit.id, polarity: -1, strength: 1 }); continue; }
      if (hit.kind === 'darkness' || hit.kind === 'length' || hit.kind === 'pace' || hit.kind === 'complexity') {
        signals.push({ ...base, kind: hit.kind, id: negated ? invertDimension(hit.kind, hit.id, softened) : hit.id, polarity: 1, strength: negated && !softened ? 0.8 : strength });
        continue;
      }
      if (hit.kind === 'mood' && hit.id === 'dark' && softened) {
        signals.push({ ...base, kind: 'darkness', id: 'not-dark', polarity: 1, strength: 1 });
        continue;
      }
      if ((hit.kind === 'audience' || hit.kind === 'translated') && negated) continue;
      signals.push({ ...base, kind: hit.kind, id: hit.id, polarity: negated ? -1 : 1, strength });
    }
  }

  for (const st of states) signals.push(...stateSignals(st.id, strategies[st.id]));
  return { signals: dedupe(signals), states, text };
}

/** Original film label («بلید رانر (Blade Runner)») for a normalized alias. */
function displayFilm(books, alias) {
  for (const b of books) {
    const idx = b.films.findIndex((f) => splitAliases(f).includes(alias));
    if (idx >= 0) return b.films[idx];
  }
  return alias;
}

/**
 * Signals contributed by a reader state with the chosen strategy
 * ('lift' changes the mood, 'match' keeps it company).
 */
export function stateSignals(stateId, strategy = 'lift') {
  const def = READER_STATES[stateId];
  if (!def) return [];
  const branch = (strategy === 'match' && def.match) ? def.match : def.lift;
  return branch.prefs.map(([kind, id, w]) => ({
    kind, id, polarity: w < 0 ? -1 : 1, strength: Math.abs(w) * 0.9, source: 'state', stateId, label: null,
  }));
}

function invertDimension(kind, id, softened) {
  const inverse = {
    length: { short: 'not-short', long: 'not-long' },
    pace: { fast: 'not-fast', slow: 'not-slow' },
    darkness: { light: 'not-light', 'not-dark': 'dark' },
    complexity: { easy: 'not-easy', deep: softened ? 'not-deep' : 'easy' },
  };
  return inverse[kind]?.[id] ?? id;
}

/** Keeps the strongest signal per kind:id:polarity. */
function dedupe(signals) {
  const map = new Map();
  for (const s of signals) {
    const key = `${s.kind}:${s.id}`;
    const prev = map.get(key);
    if (!prev || s.strength > prev.strength) map.set(key, s);
  }
  return [...map.values()];
}

/** Tokens left that the parser did not understand (for an honest "didn't get this" hint). */
export function hasContent(text) {
  return normalize(text, { stripPunctuation: true }).split(' ').some((t) => t.length > 2 && !STOPWORDS.has(t));
}
