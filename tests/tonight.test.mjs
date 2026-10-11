import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildVocab, buildCatalog } from '../js/core/catalog.js';
import { tonightPick, tonightPool, nightIndex } from '../js/features/tonight.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const { books } = buildCatalog(read('data/books.json'), buildVocab(read('data/vocab.json')));

test('tonight is stable within a night and changes at 05:00 Tehran', () => {
  // 2025-10-12 20:00 and 2025-10-13 03:00 Tehran (UTC+3:30) are the same night.
  const evening = new Date('2025-10-12T16:30:00Z');
  const lateNight = new Date('2025-10-12T23:30:00Z');
  const nextMorning = new Date('2025-10-13T02:00:00Z'); // 05:30 Tehran
  assert.equal(nightIndex(evening), nightIndex(lateNight));
  assert.equal(nightIndex(nextMorning), nightIndex(evening) + 1);
  assert.equal(tonightPick(books, { now: evening }).id, tonightPick(books, { now: lateNight }).id);
});

test('tonight never repeats within one pass of the pool and only picks translated books', () => {
  const pool = tonightPool(books);
  assert.ok(pool.length > 30);
  const start = new Date('2025-01-01T12:00:00Z').getTime();
  const seen = new Set();
  const n = Math.min(pool.length, 60);
  // Start at the beginning of a cycle so the window stays inside one permutation.
  const day0 = Math.ceil(nightIndex(new Date(start)) / pool.length) * pool.length;
  for (let i = 0; i < n; i++) {
    const b = tonightPick(books, { now: new Date((day0 + i) * 864e5 + 12 * 36e5) });
    assert.ok(b.translated);
    seen.add(b.id);
  }
  assert.equal(seen.size, n);
});
