import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildVocab, buildCatalog } from '../js/core/catalog.js';
import { compileLexicon, parseIntent } from '../js/engine/intent.js';
import { Recommender } from '../js/engine/recommender.js';
import { tonightPick, tonightPool } from '../js/features/tonight.js';
import { shardOf, shardName } from '../js/core/shard.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const booksRaw = read('data/books.json');
const vocab = buildVocab(read('data/novels-vocab.json'));
const { books: novels, issues } = buildCatalog(read('data/novels.json'), vocab);
const lexicon = compileLexicon(vocab);
const rec = new Recommender(novels, vocab);
const parse = (q, strategies) => parseIntent(q, { lexicon, books: novels, strategies });
const has = (r, kind, id, polarity = 1) => r.signals.some((s) => s.kind === kind && s.id === id && Math.sign(s.polarity) === polarity);
const top = (q, limit = 8) => rec.recommend(parse(q).signals, { limit }).items;

test('Eastern novels catalog has ~500 valid entries with zero errors/warnings and no ID collision with books', () => {
  assert.equal(issues.filter((i) => i.level === 'error').length, 0, JSON.stringify(issues.slice(0, 10)));
  assert.equal(issues.filter((i) => i.level === 'warning').length, 0, JSON.stringify(issues.slice(0, 10)));
  assert.ok(novels.length >= 490, `Expected ~500 novels, got ${novels.length}`);
  assert.equal(new Set(novels.map((n) => n.id)).size, novels.length);
  const bookIds = new Set(booksRaw.map((b) => b.id));
  const collisions = novels.filter((n) => bookIds.has(n.id));
  assert.equal(collisions.length, 0, `ID collisions: ${collisions.map((c) => c.id).join(', ')}`);
  // Check origin balance (CN, KR, JP all well represented)
  for (const origin of ['cn', 'kr', 'jp']) {
    const count = novels.filter((n) => n.origin === origin).length;
    assert.ok(count >= 120, `Origin ${origin} too small: ${count}`);
  }
});

test('Every Eastern novel has a Persian summary in its FNV-1a shard', () => {
  const shardCache = new Map();
  let missing = [];
  for (const n of novels) {
    const s = shardOf(n.id);
    if (!shardCache.has(s)) shardCache.set(s, read(`data/novel-summaries/${shardName(s)}`));
    const entry = shardCache.get(s)[n.id];
    if (!entry || !entry.text || entry.text.length < 40) missing.push(n.id);
  }
  assert.equal(missing.length, 0, `Missing summaries: ${missing.slice(0, 10).join(', ')}`);
});

test('Eastern novel intent parser detects origin, subgenre, status, adaptations, and chapter limits', () => {
  const r = parse('یه ناول کره‌ای با سیستم و دانجن، پایان‌یافته، زیر ۵۰۰ چپتر، مانهوا داشته باشه');
  assert.ok(has(r, 'origin', 'kr'));
  assert.ok(has(r, 'genre', 'system-litrpg'));
  assert.ok(has(r, 'genre', 'hunter-dungeon'));
  assert.ok(has(r, 'status', 'completed'));
  assert.ok(has(r, 'adaptation', 'manhwa'));
  assert.ok(r.signals.some((s) => s.kind === 'chapters' && s.id === 'max:500' && s.hard));

  const items = rec.recommend(r.signals, { limit: 10 }).items;
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.equal(it.book.origin, 'kr');
    assert.equal(it.book.status, 'completed');
    assert.ok(it.book.adaptations.includes('manhwa'));
    assert.ok(it.book.chapters <= 500, `${it.book.id} has ${it.book.chapters} chapters`);
  }
});

test('Eastern novel aliases and acronyms (LOTM / ارباب اسرار / سولو لولینگ / جنون کشیش) resolve cleanly as seeds', () => {
  const r1 = parse('شبیه ارباب اسرار');
  assert.ok(r1.signals.some((s) => s.kind === 'seed' && s.id === 'lord-of-the-mysteries'));
  const r2 = parse('مثل LOTM');
  assert.ok(r2.signals.some((s) => s.kind === 'seed' && s.id === 'lord-of-the-mysteries'));
  const r3 = parse('مثل سولو لولینگ');
  assert.ok(r3.signals.some((s) => s.kind === 'seed' && s.id === 'solo-leveling'));
  const r4 = parse('شبیه جنون کشیش');
  assert.ok(r4.signals.some((s) => s.kind === 'seed' && s.id === 'reverend-insanity'));
  assert.ok(!top('شبیه ارباب اسرار', 10).some((i) => i.book.id === 'lord-of-the-mysteries'));
});

test('Origin exclusion and Xianxia/Murim/Isekai queries return accurate results', () => {
  const cnXianxia = top('شیان‌شیای چینی تاریک', 6);
  assert.ok(cnXianxia.length > 0);
  assert.ok(cnXianxia.every((i) => i.book.origin === 'cn'));

  const noJp = top('موریم پرهیجان، ژاپنی نباشه', 6);
  assert.ok(noJp.length > 0);
  assert.ok(noJp.every((i) => i.book.origin !== 'jp'));
});

test('tonightPick and similarTo work cleanly on Eastern novels', () => {
  const pool = tonightPool(novels);
  assert.ok(pool.length >= 400);
  const pick = tonightPick(novels, { now: new Date('2026-06-01T18:00:00Z') });
  assert.ok(pick && pick.origin);
  const sim = rec.similarTo(pick.id, { limit: 6 });
  assert.equal(sim.length, 6);
  assert.ok(!sim.some((s) => s.book.id === pick.id));
});
