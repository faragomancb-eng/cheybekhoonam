import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, tokenize, toLatinDigits } from '../js/core/text.js';
import { buildVocab, buildCatalog, parseCsv } from '../js/core/catalog.js';
import { compileLexicon, parseIntent } from '../js/engine/intent.js';
import { Recommender } from '../js/engine/recommender.js';
import { escapeHtml } from '../js/core/dom.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const vocab = buildVocab(read('data/vocab.json'));
const { books, issues } = buildCatalog(read('data/books.json'), vocab);
const lexicon = compileLexicon(vocab);
const rec = new Recommender(books, vocab);
const parse = (q, strategies) => parseIntent(q, { lexicon, books, strategies });
const has = (r, kind, id, polarity = 1) => r.signals.some((s) => s.kind === kind && s.id === id && Math.sign(s.polarity) === polarity);
const top = (q, limit = 5) => rec.recommend(parse(q).signals, { limit }).items;

test('normalize: Arabic letters, digits, ZWNJ', () => {
  assert.equal(normalize('كتاب‌هاي علمي'), 'کتابهای علمی');
  assert.equal(toLatinDigits('۳۰۰ و ٤٥'), '300 و 45');
  assert.deepEqual(tokenize('«تل‌ماسه»، خوبه!'), ['تل', 'ماسه', 'خوبه']);
});

test('escapeHtml blocks markup from data', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('sample catalog is valid', () => {
  assert.equal(issues.filter((i) => i.level === 'error').length, 0, JSON.stringify(issues));
  assert.ok(books.length >= 30);
  assert.equal(new Set(books.map((b) => b.id)).size, books.length);
});

test('catalog reports bad rows instead of crashing', () => {
  const { books: ok, issues: bad } = buildCatalog([{ id: 'x' }, { id: 'y', title: 'ی', author: 'ن', moods: ['no-such-mood'] }], vocab);
  assert.ok(bad.some((i) => i.level === 'error'));
  assert.ok(ok.length <= 1);
});

test('CSV parser handles quotes, commas and BOM', () => {
  const rows = parseCsv('\uFEFFid,title\n"a","سلام، دنیا"\nb,"گفت ""نه"""\n');
  assert.deepEqual(rows, [{ id: 'a', title: 'سلام، دنیا' }, { id: 'b', title: 'گفت "نه"' }]);
});

test('free text: moods, negation and page limit', () => {
  const r = parse('یه چیز رازآلود و دنج، نه غمگین، زیر ۴۰۰ صفحه');
  assert.ok(has(r, 'mood', 'mysterious'));
  assert.ok(has(r, 'mood', 'cozy'));
  assert.ok(has(r, 'mood', 'melancholic', -1));
  assert.ok(r.signals.some((s) => s.kind === 'pages' && s.id === 'max:400' && s.hard));
});

test('reader state is detected even before punctuation', () => {
  assert.deepEqual(parse('خسته‌ام، یه چیز سبک').states.map((s) => s.id), ['tired']);
  assert.deepEqual(parse('دلم گرفته').states.map((s) => s.id), ['sad']);
  assert.ok(!has(parse('دلم گرفته'), 'mood', 'melancholic'), 'sad reader is lifted by default, not handed a sad book');
  assert.ok(has(parse('دلم گرفته', { sad: 'match' }), 'mood', 'melancholic'));
});

test('explicit page limit is a hard filter and wins over state hints', () => {
  for (const item of top('خسته‌ام، یه چیز رازآلود، زیر ۴۰۰ صفحه', 12)) assert.ok(item.book.pages <= 400, item.book.title);
});

test('"like X" uses the book as seed and never returns it', () => {
  const r = parse('یه چیزی مثل تل‌ماسه');
  assert.ok(r.signals.some((s) => s.kind === 'seed' && s.id === 'dune'));
  assert.ok(!top('یه چیزی مثل تل‌ماسه', 12).some((i) => i.book.id === 'dune'));
});

test('negated mood pushes those books down', () => {
  const dark = top('فانتزی، اصلاً تاریک نباشه', 5);
  assert.ok(dark.every((i) => i.book.darkness <= 3 || !i.book.moods.includes('dark')));
});

test('hidden books are excluded and results are diverse', () => {
  const items = rec.recommend(parse('علمی‌تخیلی').signals, { hidden: new Set(['dune']), limit: 9 }).items;
  assert.ok(!items.some((i) => i.book.id === 'dune'));
  const authors = items.map((i) => i.book.author);
  assert.ok(new Set(authors).size >= authors.length - 2);
});

test('similarTo and surprise return other books', () => {
  const sim = rec.similarTo('the-hobbit', { limit: 4 });
  assert.ok(sim.length > 0 && !sim.some((i) => (i.book ?? i).id === 'the-hobbit'));
  const s = rec.surprise([], { seed: 7 });
  assert.ok(s && (s.book ?? s).id);
});

test('unsafe links from the books file are dropped', () => {
  const { books: [b] } = buildCatalog([{ id: 'z', title: 'ت', author: 'ن', genres: ['sf'], moods: ['dark'], link: 'javascript:alert(1)', cover: 'assets/covers/z.jpg' }], vocab);
  assert.equal(b.link, '');
  assert.equal(b.cover, 'assets/covers/z.jpg');
});
