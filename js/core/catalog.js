/**
 * Catalog: parses, validates and normalizes the book list against the
 * controlled vocabulary. Shared by the app (runtime) and tools/validate.mjs.
 *
 * Philosophy: one bad row must never take the site down. Rows with fatal
 * problems are skipped and reported; unknown tags are dropped with a warning.
 */
import { normalize, splitAliases } from './text.js';

const LIST_FIELDS = ['translators', 'genres', 'moods', 'themes', 'warnings', 'films', 'awards'];
const VOCAB_FIELDS = { genres: 'genres', moods: 'moods', themes: 'themes', warnings: 'warnings' };
const SCALE_FIELDS = ['pace', 'darkness', 'complexity'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Builds fast lookup structures over vocab.json. */
export function buildVocab(raw) {
  const groups = {};
  for (const key of ['moods', 'genres', 'themes', 'warnings', 'formats', 'audiences']) {
    const list = Array.isArray(raw?.[key]) ? raw[key] : [];
    const byId = new Map();
    for (const entry of list) {
      if (!entry?.id || byId.has(entry.id)) continue;
      byId.set(entry.id, {
        ...entry,
        aliases: (entry.aliases ?? []).map((a) => {
          const exact = a.startsWith('=');
          return { text: normalize(exact ? a.slice(1) : a, { stripPunctuation: true }), exact };
        }).filter((a) => a.text),
      });
    }
    groups[key] = { list: [...byId.values()], byId };
  }
  return groups;
}

/** Splits a list cell. JSON arrays pass through; CSV cells use | or ، or ; */
function toList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(/\s*[|،;]\s*/).map((v) => v.trim()).filter(Boolean);
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  return Number.isFinite(n) ? n : NaN;
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'بله', 'آره', 'هست', 'دارد'].includes(s)) return true;
  if (['false', '0', 'no', 'خیر', 'نه', 'نیست', 'ندارد'].includes(s)) return false;
  return fallback;
}

/**
 * Validates and normalizes raw rows.
 * @returns {{ books: object[], issues: {level:'error'|'warning', row:number, id?:string, field?:string, message:string}[] }}
 */
export function buildCatalog(rows, vocab) {
  const issues = [];
  const books = [];
  const seen = new Set();
  const list = Array.isArray(rows) ? rows : [];

  list.forEach((raw, index) => {
    const row = index + 1;
    const report = (level, field, message) => issues.push({ level, row, id: raw?.id, field, message });
    if (!raw || typeof raw !== 'object') return report('error', null, 'ردیف خالی یا نامعتبر است.');

    const id = String(raw.id ?? '').trim();
    if (!id) return report('error', 'id', 'شناسه (id) ندارد.');
    if (!ID_PATTERN.test(id)) return report('error', 'id', `شناسه «${id}» فقط می‌تواند حروف کوچک انگلیسی، عدد و خط تیره داشته باشد.`);
    if (seen.has(id)) return report('error', 'id', `شناسه «${id}» تکراری است.`);
    if (!String(raw.title ?? '').trim()) return report('error', 'title', 'عنوان ندارد.');
    if (!String(raw.author ?? '').trim()) return report('error', 'author', 'نویسنده ندارد.');
    seen.add(id);

    const book = { ...raw, id, title: String(raw.title).trim(), author: String(raw.author).trim() };
    for (const f of LIST_FIELDS) book[f] = toList(raw[f]);

    for (const [field, group] of Object.entries(VOCAB_FIELDS)) {
      const known = [];
      for (const tag of book[field]) {
        if (vocab[group].byId.has(tag)) known.push(tag);
        else report('warning', field, `«${tag}» در vocab.json تعریف نشده و نادیده گرفته شد.`);
      }
      book[field] = [...new Set(known)];
    }
    if (book.genres.length === 0) report('warning', 'genres', 'هیچ ژانری ندارد؛ در پیشنهادها ضعیف دیده می‌شود.');
    if (book.moods.length === 0) report('warning', 'moods', 'هیچ حس‌وحالی ندارد؛ در پیشنهادها ضعیف دیده می‌شود.');

    for (const f of ['year', 'pages', 'series_number']) {
      const n = toNumber(raw[f]);
      if (Number.isNaN(n)) report('warning', f, `مقدار «${raw[f]}» عدد نیست.`);
      book[f] = Number.isFinite(n) ? n : null;
    }
    for (const f of SCALE_FIELDS) {
      const n = toNumber(raw[f]);
      if (n == null) { book[f] = null; continue; }
      if (Number.isNaN(n) || n < 1 || n > 5) {
        report('warning', f, `مقدار «${raw[f]}» باید بین ۱ تا ۵ باشد.`);
        book[f] = null;
      } else book[f] = Math.round(n);
    }

    book.audience = vocab.audiences.byId.has(raw.audience) ? raw.audience : 'adult';
    if (raw.audience && !vocab.audiences.byId.has(raw.audience)) report('warning', 'audience', `مخاطب «${raw.audience}» ناشناخته است؛ بزرگسال در نظر گرفته شد.`);
    book.format = vocab.formats.byId.has(raw.format) ? raw.format : 'novel';
    book.translated = toBool(raw.translated, book.translators.length > 0);
    book.featured = toBool(raw.featured, false);
    book.isbn = raw.isbn ? String(raw.isbn).replace(/[^0-9Xx]/g, '') : '';
    if (book.isbn && ![10, 13].includes(book.isbn.length)) report('warning', 'isbn', 'شابک باید ۱۰ یا ۱۳ رقم باشد.');

    for (const f of ['title_en', 'author_en', 'series', 'quote', 'summary', 'cover', 'wiki_fa', 'wiki_en', 'link', 'note']) {
      book[f] = raw[f] == null ? '' : String(raw[f]).trim();
    }
    // Only web links or local paths; never javascript:/data: URLs from a spreadsheet cell.
    for (const f of ['link', 'cover']) {
      if (book[f] && !/^(https?:\/\/|\.?\/|assets\/)/i.test(book[f])) {
        report('warning', f, `آدرس «${book[f]}» معتبر نیست و نادیده گرفته شد.`);
        book[f] = '';
      }
    }

    // Precomputed matching data (not part of the public schema).
    const titleAliases = new Set([
      ...splitAliases(book.title), ...splitAliases(book.title_en),
      ...(book.series ? splitAliases(book.series) : []),
    ]);
    book._aliases = [...titleAliases].filter((a) => a.length >= 3);
    book._films = book.films.flatMap(splitAliases).filter((a) => a.length >= 3);
    book._haystack = normalize([
      book.title, book.title_en, book.author, book.author_en, book.series,
      ...book.translators, ...book.films,
    ].join(' '), { stripPunctuation: true });
    books.push(book);
  });

  return { books, issues };
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()])));
}

/** Parses a books file by extension. */
export function parseBooksFile(path, text) {
  return /\.csv$/i.test(path) ? parseCsv(text) : JSON.parse(text);
}
