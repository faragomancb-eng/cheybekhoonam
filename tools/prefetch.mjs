// Builds data/summaries/NN.json (summary per book, split into small files),
// data/covers.json (cover URL per book) and data/feed.json (latest posts).
// Runs in GitHub Actions, so visitors never wait for (or get blocked by) Wikipedia.
// Only books that have never been looked up are fetched; a run stops after
// --limit books or --minutes minutes and the next run continues where it left off.
// Usage: npm run prefetch [-- --limit=500] [-- --minutes=40] [-- --force] [-- --only=dune,piranesi] [-- --retry-missing]
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCatalog, readJson, root } from './lib.mjs';
import { lookupSummary } from '../js/services/summaries.js';
import { SHARDS, shardOf, shardName } from '../js/core/shard.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : fallback; };
const force = args.includes('--force');
const retryMissing = args.includes('--retry-missing');
const only = opt('only')?.split(',');
const limit = Number(opt('limit', process.env.PREFETCH_LIMIT ?? 600));
const deadline = Date.now() + Number(opt('minutes', process.env.PREFETCH_MINUTES ?? 45)) * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.join(root, 'data/summaries');
const coversFile = path.join(root, 'data/covers.json');
const { CONFIG } = await import(path.join(root, 'js/config.js'));
const FEED_URL = process.env.FEED_URL ?? `${CONFIG.parentUrl.replace(/\/$/, '')}/feed`;

const { books } = await loadCatalog();
await fs.mkdir(dir, { recursive: true });

// Everything fetched so far. `{ none: date }` marks books where nothing was found,
// so they are not retried on every run (use --retry-missing for that).
const known = {};
for (let n = 0; n < SHARDS; n++) Object.assign(known, await readJson(path.join(dir, shardName(n)), {}));
const legacy = await readJson(path.join(root, 'data/summaries.json'), null); // older single-file format
if (legacy) for (const [id, v] of Object.entries(legacy)) known[id] ??= v;

const ids = new Set(books.map((b) => b.id));
const queue = books.filter((b) => {
  if (b.summary && b.cover) return false; // editor wrote both
  if (only) return only.includes(b.id);
  const k = known[b.id];
  if (!k || force) return true;
  return retryMissing && k.none;
});

let fetched = 0; let missing = 0; let done = 0;
const save = async () => {
  const shards = Array.from({ length: SHARDS }, () => ({}));
  const covers = {};
  for (const [id, v] of Object.entries(known)) {
    if (!ids.has(id)) continue; // book was removed from the list
    shards[shardOf(id)][id] = v;
    if (v.cover) covers[id] = v.cover;
  }
  await Promise.all(shards.map((s, n) => fs.writeFile(path.join(dir, shardName(n)), `${JSON.stringify(s)}\n`)));
  await fs.writeFile(coversFile, `${JSON.stringify(covers)}\n`);
};

console.log(`${queue.length} کتاب در صف (حداکثر ${limit} در این اجرا)`);
for (const book of queue) {
  if (done >= limit || Date.now() > deadline) { console.log('به سقف این اجرا رسیدیم؛ اجرای بعدی ادامه می‌دهد.'); break; }
  done++;
  const data = await lookupSummary(book, { googleApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? CONFIG.googleBooksApiKey, timeoutMs: 12000 });
  const day = new Date().toISOString().slice(0, 10);
  if (data) { known[book.id] = { ...data, fetchedAt: day }; fetched++; console.log(`✓ ${book.id} ← ${data.source}`); }
  else { missing++; known[book.id] ??= { none: day }; console.log(`– ${book.id}: خلاصه‌ای پیدا نشد`); }
  if (done % 50 === 0) await save(); // keep progress if the job is cut off
  await sleep(700); // be polite to Wikimedia
}
await save();
if (legacy) await fs.rm(path.join(root, 'data/summaries.json'), { force: true });
const have = books.filter((b) => known[b.id]?.text).length;
console.log(`خلاصه: ${have} از ${books.length} کتاب (${fetched} تازه، ${missing} پیدا نشد، ${queue.length - done} مانده)`);

// Latest posts from the parent site's RSS feed (optional; failure is fine).
try {
  const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'chi-bekhoonam/2.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(String(res.status));
  const xml = await res.text();
  const pick = (block, tag) => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, 6).map(([block]) => {
    const date = new Date(pick(block, 'pubDate'));
    return {
      title: pick(block, 'title').replace(/&#8211;/g, '–').replace(/&amp;/g, '&').replace(/&#\d+;/g, ''),
      url: pick(block, 'link'),
      date: Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }),
    };
  }).filter((i) => i.title && /^https?:/.test(i.url));
  if (items.length) {
    await fs.writeFile(path.join(root, 'data/feed.json'), `${JSON.stringify(items, null, 2)}\n`);
    console.log(`feed.json: ${items.length} نوشته`);
  }
} catch (err) {
  console.log(`feed: دریافت نشد (${err.message}) — بخش «تازه‌ها» نمایش داده نمی‌شود.`);
}
