/**
 * Recommender: turns a list of signals into ranked, explained suggestions.
 *
 * - Hard filters only for things a reader states as non-negotiable
 *   (content warnings, «only translated», explicit page limits, strong «no»).
 * - Everything else is a soft preference combined as a weighted average of
 *   only the components the reader actually expressed, so an unexpressed
 *   preference never drags a score down.
 * - Final ordering uses Maximal Marginal Relevance so the top picks are not
 *   five copies of the same sub-genre.
 */

const MOOD_POSITION_WEIGHTS = [1, 0.85, 0.72, 0.62, 0.55, 0.5];
const WEIGHTS = { mood: 3, seed: 3, genre: 2, theme: 2, author: 2.2, format: 1, pages: 1, pace: 1, darkness: 1.2, complexity: 1 };
const PAGE_BUCKETS = { short: { max: 300 }, medium: { min: 250, max: 500 }, long: { min: 450 }, 'not-short': { min: 220 }, 'not-long': { max: 480 } };
const PACE_TARGETS = { slow: 2, steady: 3, fast: 4.5, 'not-fast': 2.5, 'not-slow': 3.8 };
const DARKNESS_RANGES = { light: [1, 2], 'not-dark': [1, 3], dark: [4, 5], 'not-light': [3, 5] };
const COMPLEXITY_RANGES = { easy: [1, 3], deep: [4, 5], 'not-easy': [3, 5], 'not-deep': [1, 3] };

/** Small deterministic PRNG so "show me others" is reproducible per seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Recommender {
  /** @param {object[]} books normalized catalog @param {object} vocab built vocab */
  constructor(books, vocab) {
    this.vocab = vocab;
    this.books = books;
    this.byId = new Map(books.map((b) => [b.id, b]));
    this.#index();
  }

  #index() {
    const n = Math.max(1, this.books.length);
    const df = new Map();
    const parent = new Map(this.vocab.genres.list.filter((g) => g.parent).map((g) => [g.id, g.parent]));
    this.near = new Map(this.vocab.moods.list.map((m) => [m.id, m.near ?? []]));

    this.profiles = new Map();
    for (const b of this.books) {
      const genres = new Set(b.genres);
      for (const g of b.genres) if (parent.has(g)) genres.add(parent.get(g));
      const moods = new Map(b.moods.map((m, i) => [m, MOOD_POSITION_WEIGHTS[Math.min(i, MOOD_POSITION_WEIGHTS.length - 1)]]));
      const p = { genres, moods, themes: new Set(b.themes), warnings: new Set(b.warnings) };
      this.profiles.set(b.id, p);
      for (const key of [...[...genres].map((g) => `g:${g}`), ...b.themes.map((t) => `t:${t}`)]) df.set(key, (df.get(key) ?? 0) + 1);
    }
    const idf = (key) => Math.log(1 + n / (df.get(key) ?? 1));

    for (const b of this.books) {
      const p = this.profiles.get(b.id);
      const vec = new Map();
      for (const g of p.genres) vec.set(`g:${g}`, 0.9 * idf(`g:${g}`));
      for (const t of p.themes) vec.set(`t:${t}`, 1.1 * idf(`t:${t}`));
      for (const [m, w] of p.moods) vec.set(`m:${m}`, 1.3 * w);
      for (const d of ['pace', 'darkness', 'complexity']) if (b[d] != null) vec.set(`d:${d}`, ((b[d] - 3) / 2) * 0.8);
      let norm = 0;
      for (const v of vec.values()) norm += v * v;
      p.vec = vec;
      p.norm = Math.sqrt(norm) || 1;
    }
  }

  /** Ids of books that list a film alias. */
  filmBooks(alias) {
    if (!this.filmIndex) {
      this.filmIndex = new Map();
      for (const b of this.books) for (const a of b._films) {
        if (!this.filmIndex.has(a)) this.filmIndex.set(a, []);
        this.filmIndex.get(a).push(b.id);
      }
    }
    return this.filmIndex.get(alias) ?? [];
  }

  /** Short display label for a film alias (Persian part only). */
  filmLabel(alias) {
    for (const b of this.books) {
      const i = b._films.indexOf(alias);
      if (i >= 0) {
        const film = b.films.find((f) => f.toLowerCase().includes(alias) || f.includes(alias)) ?? b.films[0];
        return film.replace(/\s*\(.*\)\s*/, '').trim() || alias;
      }
    }
    return alias;
  }

  /** Cosine similarity between two books (0..1). */
  similarity(aId, bId) {
    const a = this.profiles.get(aId);
    const b = this.profiles.get(bId);
    if (!a || !b) return 0;
    const [small, large] = a.vec.size < b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
    let dot = 0;
    for (const [k, v] of small) { const w = large.get(k); if (w !== undefined) dot += v * w; }
    return Math.max(0, dot / (a.norm * b.norm));
  }

  /** Collapses raw signals into a query object. */
  aggregate(signals) {
    const q = {
      moods: new Map(), genres: new Map(), themes: new Map(), formats: new Map(),
      warnings: new Set(), seeds: new Map(), films: new Map(), authors: new Set(),
      pages: null, pace: null, darkness: null, complexity: null, audience: null, translatedOnly: false,
      active: 0,
    };
    const addTo = (map, id, v) => map.set(id, (map.get(id) ?? 0) + v);
    for (const s of signals) {
      const v = (s.polarity ?? 1) * (s.strength ?? 1);
      switch (s.kind) {
        case 'mood': addTo(q.moods, s.id, v); break;
        case 'genre': addTo(q.genres, s.id, v); break;
        case 'theme': addTo(q.themes, s.id, v); break;
        case 'format': addTo(q.formats, s.id, v); break;
        case 'warning': q.warnings.add(s.id); break;
        case 'seed': addTo(q.seeds, s.id, v); break;
        case 'film': addTo(q.films, s.id, v); break;
        case 'author': q.authors.add(s.id); break;
        case 'translated': q.translatedOnly = true; break;
        case 'audience': q.audience = s.id; break;
        case 'length':
          // An explicit page count («زیر ۳۰۰ صفحه») beats a vague length word or a state's hint.
          if (!q.pages?.hard && !q.pages?.explicit) q.pages = { ...PAGE_BUCKETS[s.id], hard: false, id: s.id, w: s.strength ?? 1 };
          break;
        case 'pages': {
          const [kind, num] = String(s.id).split(':');
          const n = Number(num);
          const prev = q.pages?.explicit ? q.pages : {};
          if (kind === 'max') q.pages = { ...prev, max: n, hard: s.hard !== false, explicit: true, w: 1 };
          else if (kind === 'min') q.pages = { ...prev, min: n, hard: s.hard !== false, explicit: true, w: 1 };
          else q.pages = { target: n, min: Math.round(n * 0.7), max: Math.round(n * 1.3), hard: false, explicit: true, w: 1 };
          break;
        }
        case 'pace': q.pace = { target: PACE_TARGETS[s.id] ?? 3, id: s.id, w: s.strength ?? 1 }; break;
        case 'darkness': q.darkness = { range: DARKNESS_RANGES[s.id] ?? [1, 5], id: s.id, w: s.strength ?? 1 }; break;
        case 'complexity': q.complexity = { range: COMPLEXITY_RANGES[s.id] ?? [1, 5], id: s.id, w: s.strength ?? 1 }; break;
        default: break;
      }
    }
    q.active = signals.length;
    return q;
  }

  /** Hard filters. Returns a reason key when excluded, or null. */
  #exclusion(book, p, q, ctx) {
    if (ctx.hidden.has(book.id)) return 'hidden';
    if ((q.seeds.get(book.id) ?? 0) !== 0) return 'seed';
    for (const w of q.warnings) if (p.warnings.has(w)) return `warning:${w}`;
    if (q.translatedOnly && !book.translated) return 'translated';
    if (q.audience === 'ya' && book.audience === 'adult') return 'audience';
    if (q.audience === 'adult' && book.audience === 'ya') return 'audience';
    if (q.pages?.hard && book.pages != null) {
      if (q.pages.max && book.pages > q.pages.max) return 'pages';
      if (q.pages.min && book.pages < q.pages.min) return 'pages';
    }
    for (const [g, v] of q.genres) if (v <= -1 && p.genres.has(g)) return `genre:${g}`;
    for (const [t, v] of q.themes) if (v <= -1 && p.themes.has(t)) return `theme:${t}`;
    for (const [m, v] of q.moods) if (v <= -1.3 && (p.moods.get(m) ?? 0) >= 0.85) return `mood:${m}`;
    return null;
  }

  #score(book, p, q) {
    const parts = [];
    const reasons = [];
    const caveats = [];
    const label = (group, id) => this.vocab[group].byId.get(id)?.label ?? id;
    let penalty = 0;

    // Moods: weighted coverage with partial credit for neighbouring moods.
    const posMoods = [...q.moods].filter(([, v]) => v > 0);
    if (posMoods.length) {
      let sum = 0; let total = 0;
      for (const [m, v] of posMoods) {
        const direct = p.moods.get(m) ?? 0;
        let near = 0;
        for (const n of this.near.get(m) ?? []) near = Math.max(near, (p.moods.get(n) ?? 0) * 0.45);
        sum += v * Math.max(direct, near);
        total += v;
        if (direct > 0) reasons.push({ w: v * direct * 3, text: label('moods', m) });
      }
      parts.push(['mood', sum / total]);
    }
    for (const [m, v] of q.moods) {
      if (v >= 0) continue;
      const has = p.moods.get(m) ?? 0;
      if (has > 0) { penalty += Math.min(0.35, -v * has * 0.3); caveats.push(`کمی ${label('moods', m)} هم هست`); }
    }

    const setScore = (map, has, group, kind, weightBoost = 1) => {
      const pos = [...map].filter(([, v]) => v > 0);
      for (const [id, v] of map) if (v < 0 && has(id)) { penalty += 0.15 * -v; caveats.push(`${label(group, id)} هم دارد`); }
      if (!pos.length) return;
      let sum = 0; let total = 0;
      for (const [id, v] of pos) {
        const hit = has(id) ? 1 : 0;
        sum += v * hit; total += v;
        if (hit) reasons.push({ w: v * 2.5 * weightBoost, text: label(group, id) });
      }
      parts.push([kind, sum / total]);
    };
    setScore(q.genres, (g) => p.genres.has(g), 'genres', 'genre');
    setScore(q.themes, (t) => p.themes.has(t), 'themes', 'theme', 1.1);
    setScore(q.formats, (f) => book.format === f, 'formats', 'format');

    // Seeds: similar to books (or films) the reader mentioned.
    const pos = [...q.seeds].filter(([, v]) => v > 0);
    if (pos.length) {
      const sims = pos.map(([id, v]) => [id, this.similarity(id, book.id) * Math.min(1, v)]);
      const max = Math.max(...sims.map(([, s]) => s));
      const mean = sims.reduce((a, [, s]) => a + s, 0) / sims.length;
      parts.push(['seed', Math.min(1, (0.65 * max + 0.35 * mean) * 1.35)]);
      const best = sims.sort((a, b) => b[1] - a[1])[0];
      if (best[1] > 0.3) reasons.push({ w: 4 * best[1], text: `حال‌وهوای «${this.byId.get(best[0])?.title ?? ''}»` });
    }
    for (const [id, v] of q.seeds) if (v < 0) penalty += this.similarity(id, book.id) * 0.4 * -v;

    // Films/series: books that list the film match directly; others by similarity.
    const posFilms = [...q.films].filter(([, v]) => v > 0);
    if (posFilms.length) {
      let best = 0; let via = null;
      for (const [alias] of posFilms) {
        const direct = book._films.includes(alias) ? 1 : 0;
        let sim = 0;
        for (const id of this.filmBooks(alias)) if (id !== book.id) sim = Math.max(sim, this.similarity(id, book.id));
        const s = Math.max(direct, Math.min(1, sim * 1.15) * 0.85);
        if (s > best) { best = s; via = alias; }
      }
      parts.push(['seed', best]);
      if (best > 0.45) reasons.push({ w: 4 * best, text: `حال‌وهوای «${this.filmLabel(via)}»` });
    }
    for (const [alias, v] of q.films) if (v < 0 && book._films.includes(alias)) penalty += 0.3;

    if (q.authors.size) {
      const hit = q.authors.has(book.author);
      parts.push(['author', hit ? 1 : 0]);
      if (hit) reasons.push({ w: 5, text: `از ${book.author}` });
    }

    if (q.pages) {
      const { min, max, target } = q.pages;
      let s = 0.6;
      if (book.pages != null) {
        if (target) s = Math.exp(-Math.abs(book.pages - target) / (0.35 * target));
        else if (max && book.pages > max) s = Math.exp(-(book.pages - max) / 160);
        else if (min && book.pages < min) s = Math.exp(-(min - book.pages) / 160);
        else s = 1;
        if (s >= 0.95 && max && book.pages <= max) reasons.push({ w: 1.2, text: `${book.pages} صفحه` });
        if (s < 0.6) caveats.push(book.pages > (max ?? target ?? 0) ? `بلندتر از چیزی که خواستی (${book.pages} صفحه)` : `کوتاه‌تر از چیزی که خواستی (${book.pages} صفحه)`);
      }
      parts.push(['pages', s, q.pages.w]);
    }
    if (q.pace) {
      const s = book.pace == null ? 0.6 : Math.max(0, 1 - Math.abs(book.pace - q.pace.target) / 2.5);
      if (s >= 0.8 && q.pace.id === 'fast') reasons.push({ w: 1, text: 'ریتم تند' });
      if (s >= 0.8 && q.pace.id === 'slow') reasons.push({ w: 1, text: 'ریتم آرام' });
      parts.push(['pace', s, q.pace.w]);
    }
    const rangeScore = (value, [lo, hi]) => (value == null ? 0.6 : value < lo ? Math.max(0, 1 - 0.4 * (lo - value)) : value > hi ? Math.max(0, 1 - 0.4 * (value - hi)) : 1);
    if (q.darkness) {
      const s = rangeScore(book.darkness, q.darkness.range);
      if (s < 0.7 && book.darkness > q.darkness.range[1]) caveats.push('تاریک‌تر از حال‌وهوایی که گفتی');
      parts.push(['darkness', s, q.darkness.w]);
    }
    if (q.complexity) {
      const s = rangeScore(book.complexity, q.complexity.range);
      if (s >= 1 && q.complexity.id === 'easy') reasons.push({ w: 1.1, text: 'خوش‌خوان' });
      if (s < 0.7 && q.complexity.w >= 1 && book.complexity > q.complexity.range[1]) caveats.push('خوندنش کمی حوصله می‌خواد');
      parts.push(['complexity', s, q.complexity.w]);
    }

    let num = 0; let den = 0;
    for (const [kind, s, mult = 1] of parts) { const w = WEIGHTS[kind] * mult; num += w * s; den += w; }
    const base = den > 0 ? num / den : 0;
    const prior = (book.featured ? 0.03 : 0) + Math.min(book.awards.length, 3) * 0.008;
    const score = Math.max(0, Math.min(1, base - penalty)) + prior;
    reasons.sort((a, b) => b.w - a.w);
    return {
      score,
      fit: den === 0 ? null : base - penalty >= 0.72 ? 'strong' : base - penalty >= 0.5 ? 'good' : 'loose',
      reasons: [...new Set(reasons.map((r) => r.text))].slice(0, 4),
      caveats: [...new Set(caveats)].slice(0, 2),
    };
  }

  /**
   * @param {object[]} signals
   * @param {{hidden?:Set<string>, limit?:number, shuffle?:number}} options
   */
  recommend(signals, { hidden = new Set(), limit = 12, shuffle = 0 } = {}) {
    const q = this.aggregate(signals);
    const ctx = { hidden };
    const scored = [];
    const excludedBy = new Map();
    const rand = shuffle ? mulberry32(shuffle * 2654435761) : null;

    for (const book of this.books) {
      const p = this.profiles.get(book.id);
      const why = this.#exclusion(book, p, q, ctx);
      if (why) { excludedBy.set(why, (excludedBy.get(why) ?? 0) + 1); continue; }
      const r = this.#score(book, p, q);
      if (rand) r.score += (rand() - 0.5) * 0.16;
      scored.push({ book, ...r });
    }
    scored.sort((a, b) => b.score - a.score);
    const ranked = this.#diversify(scored, Math.min(scored.length, Math.max(limit * 2, 24)));
    return {
      items: ranked.slice(0, limit),
      total: scored.length,
      hasQuery: q.active > 0,
      relax: this.#relaxHint(excludedBy),
      query: q,
    };
  }

  /** Maximal Marginal Relevance re-ranking of the head of the list. */
  #diversify(sorted, head, lambda = 0.8) {
    const pool = sorted.slice(0, head);
    const out = [];
    while (pool.length) {
      let bestIdx = 0; let bestVal = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        let maxSim = 0;
        for (const s of out) maxSim = Math.max(maxSim, this.similarity(pool[i].book.id, s.book.id));
        const val = lambda * pool[i].score - (1 - lambda) * maxSim;
        if (val > bestVal) { bestVal = val; bestIdx = i; }
      }
      out.push(pool.splice(bestIdx, 1)[0]);
    }
    return out.concat(sorted.slice(head));
  }

  /** Suggests the single hard filter that, if removed, would bring back the most books. */
  #relaxHint(excludedBy) {
    let best = null;
    for (const [key, count] of excludedBy) {
      if (key === 'hidden' || key === 'seed') continue;
      if (!best || count > best.count) best = { key, count };
    }
    return best;
  }

  /** Books similar to one book, diversified. */
  similarTo(bookId, { limit = 6, hidden = new Set() } = {}) {
    const items = this.books
      .filter((b) => b.id !== bookId && !hidden.has(b.id))
      .map((b) => ({ book: b, score: this.similarity(bookId, b.id) }))
      .sort((a, b) => b.score - a.score);
    return this.#diversify(items, Math.min(items.length, 18), 0.85).slice(0, limit);
  }

  /** A surprise pick from the reader's current best matches. */
  surprise(signals, { hidden = new Set(), seed = Date.now() } = {}) {
    const { items } = this.recommend(signals, { hidden, limit: 8 });
    if (!items.length) return null;
    const rand = mulberry32(seed);
    return items[Math.floor(rand() * items.length)].book;
  }
}
