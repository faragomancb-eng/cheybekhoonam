// Builds data/summaries.json (summary + cover per book) and data/feed.json (latest posts).
// Runs in GitHub Actions on every deploy, so visitors never wait for (or get blocked by) Wikipedia.
// Only books missing from summaries.json are fetched; use --force to refetch everything.
// Usage: npm run prefetch [-- --force] [-- --only=dune,piranesi]
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCatalog, readJson, root } from './lib.mjs';
import { lookupSummary } from '../js/services/summaries.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outFile = path.join(root, 'data/summaries.json');
const { CONFIG } = await import(path.join(root, 'js/config.js'));
const FEED_URL = process.env.FEED_URL ?? `${CONFIG.parentUrl.replace(/\/$/, '')}/feed`;

const { books } = await loadCatalog();
const existing = await readJson(outFile, {});
const out = {};
let fetched = 0; let missing = 0;

for (const book of books) {
  const keep = existing[book.id];
  const wanted = !only || only.includes(book.id);
  if (book.summary) continue; // editor-written summary wins
  if (keep && !force && !(only && wanted)) { out[book.id] = keep; continue; }
  if (!wanted) { if (keep) out[book.id] = keep; continue; }
  const data = await lookupSummary(book, { googleApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? CONFIG.googleBooksApiKey, timeoutMs: 12000 });
  if (data) { out[book.id] = { ...data, fetchedAt: new Date().toISOString().slice(0, 10) }; fetched++; console.log(`✓ ${book.id} ← ${data.source}`); }
  else { missing++; if (keep) out[book.id] = keep; console.log(`– ${book.id}: خلاصه‌ای پیدا نشد`); }
  await sleep(900); // be polite to Wikimedia
}

await fs.writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`);
console.log(`summaries.json: ${Object.keys(out).length} کتاب (${fetched} تازه، ${missing} بی‌خلاصه)`);

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
