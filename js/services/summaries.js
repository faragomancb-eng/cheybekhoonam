/**
 * Book summaries without writing them by hand.
 *
 * Resolution order (first hit wins):
 *   1. `summary` written in books.json (editor override)
 *   2. data/summaries.json, pre-built by tools/prefetch.mjs (GitHub Action)
 *   3. localStorage cache of an earlier live lookup
 *   4. Live lookup: Persian Wikipedia → Google Books (Persian) → English Wikipedia
 *      → Google Books (any language) → Open Library
 *
 * The lookup functions are isomorphic (browser + Node 20+) and only use
 * endpoints that allow cross-origin requests without a proxy.
 */

const UA_HEADERS = typeof window === 'undefined'
  ? { 'User-Agent': 'chi-bekhoonam/2.0 (book recommendation site; prefetch script)', 'Api-User-Agent': 'chi-bekhoonam/2.0' }
  : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with timeout and polite retry on 429/503. Returns null on failure. */
async function getJson(url, { timeoutMs = 8000, fetchImpl = fetch, retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, headers: UA_HEADERS });
      if (res.status === 429 || res.status === 503) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * (attempt + 1) ** 2;
        await sleep(Math.min(wait, 20000));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt === retries) return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const wikiApi = (lang) => `https://${lang}.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*`;

/** English Wikipedia title → Persian title via interlanguage links. */
async function faTitleFromEn(enTitle, opts) {
  const url = `${wikiApi('en')}&action=query&redirects=1&prop=langlinks&lllang=fa&titles=${encodeURIComponent(enTitle)}`;
  const data = await getJson(url, opts);
  return data?.query?.pages?.[0]?.langlinks?.[0]?.title ?? null;
}

/** Best English Wikipedia article for a book, found by search. */
async function searchEnTitle(book, opts) {
  if (!book.title_en) return null;
  const q = `${book.title_en} ${book.author_en ?? ''} novel`.trim();
  const url = `${wikiApi('en')}&action=query&list=search&srlimit=8&srprop=&srsearch=${encodeURIComponent(q)}`;
  const data = await getJson(url, opts);
  const hits = data?.query?.search ?? [];
  const clean = (t) => t.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const key = clean(book.title_en);
  const rank = (h) => { const t = clean(h.title); return t === key ? 3 : t.startsWith(key) ? 2 : t.includes(key) ? 1 : 0; };
  const best = hits.map((h) => [h, rank(h)]).filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1])[0];
  return best?.[0].title ?? null;
}

/** Persian Wikipedia search by Persian title + author, accepted only if titles overlap. */
async function searchFaTitle(book, opts) {
  const q = `${book.title.replace(/\(.*?\)/g, '')} ${book.author}`;
  const url = `${wikiApi('fa')}&action=query&list=search&srlimit=3&srprop=&srsearch=${encodeURIComponent(q)}`;
  const data = await getJson(url, opts);
  const norm = (t) => t.replace(/[\u200c\s()]+/g, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
  const key = norm(book.title.replace(/\(.*?\)/g, ''));
  const hit = (data?.query?.search ?? []).find((h) => norm(h.title.replace(/\(.*?\)/g, '')) === key);
  return hit?.title ?? null;
}

async function wikiSummary(lang, title, opts) {
  if (!title) return null;
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`;
  const data = await getJson(url, opts);
  if (!data || data.type === 'disambiguation' || !data.extract || data.extract.length < 80) return null;
  return {
    text: data.extract.trim(),
    lang,
    source: lang === 'fa' ? 'ویکی‌پدیای فارسی' : 'ویکی‌پدیای انگلیسی',
    url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    cover: data.originalimage?.source ?? data.thumbnail?.source ?? null,
  };
}

function stripHtml(s) {
  return String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

async function googleBooks(book, { apiKey, lang, ...opts }) {
  const parts = book.isbn ? [`isbn:${book.isbn}`] : [];
  if (!parts.length && book.title_en) parts.push(`intitle:${book.title_en}`, book.author_en ? `inauthor:${book.author_en}` : '');
  if (!parts.length) parts.push(`intitle:${book.title}`);
  let url = `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(parts.filter(Boolean).join(' '))}`;
  if (lang) url += `&langRestrict=${lang}`;
  if (apiKey) url += `&key=${encodeURIComponent(apiKey)}`;
  const data = await getJson(url, opts);
  const item = (data?.items ?? []).find((it) => (it.volumeInfo?.description ?? '').length > 80);
  if (!item) return null;
  const v = item.volumeInfo;
  return {
    text: stripHtml(v.description),
    lang: v.language === 'fa' ? 'fa' : 'en',
    source: 'Google Books',
    url: v.infoLink ?? v.canonicalVolumeLink ?? null,
    cover: v.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
  };
}

async function openLibrary(book, opts) {
  if (!book.isbn) return null;
  const edition = await getJson(`https://openlibrary.org/isbn/${book.isbn}.json`, opts);
  const workKey = edition?.works?.[0]?.key;
  if (!workKey) return null;
  const work = await getJson(`https://openlibrary.org${workKey}.json`, opts);
  const d = typeof work?.description === 'string' ? work.description : work?.description?.value;
  if (!d || d.length < 80) return null;
  return { text: d.replace(/\r/g, '').split(/\n-{3,}|\n\(\[source\]/)[0].trim(), lang: 'en', source: 'Open Library', url: `https://openlibrary.org${workKey}`, cover: null };
}

/**
 * Looks a summary up online. Never throws.
 * @param {object} book normalized book
 * @param {{googleApiKey?:string, timeoutMs?:number, fetchImpl?:Function}} options
 */
export async function lookupSummary(book, { googleApiKey = '', timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const opts = { timeoutMs, fetchImpl };
  try {
    let enTitle = book.wiki_en || null;
    let faTitle = book.wiki_fa || null;
    if (!faTitle) {
      if (!enTitle) enTitle = await searchEnTitle(book, opts);
      if (enTitle) faTitle = await faTitleFromEn(enTitle, opts);
      if (!faTitle) faTitle = await searchFaTitle(book, opts);
    }
    const fa = await wikiSummary('fa', faTitle, opts);
    if (fa) return fa;

    const gFa = await googleBooks(book, { ...opts, apiKey: googleApiKey, lang: 'fa' });
    if (gFa?.lang === 'fa') return gFa;

    const en = await wikiSummary('en', enTitle ?? (await searchEnTitle(book, opts)), opts);
    if (en) return en;

    return (await googleBooks(book, { ...opts, apiKey: googleApiKey })) ?? (await openLibrary(book, opts));
  } catch {
    return null;
  }
}

/** First `n` sentences, for a spoiler-light preview. */
export function leadSentences(text, n = 3) {
  const parts = String(text).match(/[^.!?؟。]+[.!?؟。]+["»)]?\s*/g);
  if (!parts || parts.length <= n) return { lead: String(text).trim(), rest: '' };
  return { lead: parts.slice(0, n).join('').trim(), rest: parts.slice(n).join('').trim() };
}
