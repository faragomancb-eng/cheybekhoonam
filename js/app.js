/**
 * Application controller: owns state, wires events, and asks views to render.
 */
import { CONFIG } from './config.js';
import { $, $$, on, mount, html, debounce } from './core/dom.js';
import { storage } from './core/storage.js';
import { normalize } from './core/text.js';
import { buildVocab, buildCatalog, parseBooksFile } from './core/catalog.js';
import { compileLexicon, parseIntent, hasContent } from './engine/intent.js';
import { Recommender } from './engine/recommender.js';
import { lookupSummary, leadSentences } from './services/summaries.js';
import { installCoverFallbacks } from './services/covers.js';
import { signalKey } from './ui/labels.js';
import { fa } from './ui/format.js';
import { icon } from './ui/icons.js';
import * as V from './ui/views.js';

const SINGLE_KINDS = new Set(['length', 'pages', 'pace', 'darkness', 'complexity', 'audience', 'translated']);
const EXAMPLES = [
  'یه چیز تاریک و فلسفی، ولی نه خیلی طولانی',
  'خسته‌ام؛ یه چیز سبک و بامزه می‌خوام',
  'شبیه تل‌ماسه، ولی کوتاه‌تر',
  'فانتزی گرم برای پسر نوجوانم، بدون عنکبوت!',
  'علمی‌تخیلی با بیگانه‌ها که فکرم رو درگیر کنه',
  'یه داستان رازآلود که نتونم زمین بذارمش',
  'حال‌وهوای بلید رانر',
  'دلم گرفته',
  'فقط ۵ ساعت وقت دارم',
  'یه چیزی از لوگویین',
  'بدون جادو، پرتعلیق، زیر ۴۰۰ صفحه',
];

async function fetchText(url, { optional = false } = {}) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.text();
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

class App {
  state = {
    text: '', parsed: { signals: [], states: [] }, dropped: new Set(), picks: new Map(), strategies: {},
    likes: [], shuffle: 0, shown: CONFIG.pageSize, showAllThemes: false, mode: 'write',
  };

  shelf = { want: [], read: [], nope: [] };
  summaries = new Map();
  baked = {};

  async start() {
    installCoverFallbacks(document);
    this.#bindBackdrop();
    try {
      const [booksText, vocabText, bakedText, feedText] = await Promise.all([
        fetchText(CONFIG.booksUrl), fetchText(CONFIG.vocabUrl),
        fetchText(CONFIG.summariesUrl, { optional: true }), fetchText(CONFIG.feedUrl, { optional: true }),
      ]);
      this.vocab = buildVocab(JSON.parse(vocabText));
      const { books, issues } = buildCatalog(parseBooksFile(CONFIG.booksUrl, booksText), this.vocab);
      if (issues.length) console.warn(`books: ${issues.length} مورد قابل بررسی`, issues);
      this.books = books;
      this.byId = new Map(books.map((b) => [b.id, b]));
      this.baked = bakedText ? JSON.parse(bakedText) : {};
      this.feed = feedText ? JSON.parse(feedText) : [];
    } catch (err) {
      console.error(err);
      mount($('#results'), html`<div class="empty"><h2 class="display">فهرست کتاب‌ها باز نشد</h2><p>اینترنتت رو چک کن و صفحه رو دوباره باز کن.</p></div>`);
      document.body.classList.remove('is-loading');
      return;
    }

    this.rec = new Recommender(this.books, this.vocab);
    this.lexicon = compileLexicon(this.vocab);
    this.counts = this.#counts();
    this.#loadShelf();
    this.ctx = this.#context();
    this.#restoreFromHash();
    this.#bindEvents();
    this.#renderExamples();
    mount($('#feed'), V.feedView(this.feed, this.ctx));
    $('#feed').hidden = !this.feed?.length;
    this.#updateShelfBadge();
    this.update({ reparse: true });
    document.body.classList.remove('is-loading');

    const book = new URLSearchParams(location.hash.slice(1)).get('b');
    if (book && this.byId.has(book)) this.openBook(book);
  }

  /* ---------- derived data ---------- */

  #counts() {
    const c = { genres: new Map(), themes: new Map(), warnings: new Map(), formats: new Map() };
    const inc = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
    const parent = new Map(this.vocab.genres.list.filter((g) => g.parent).map((g) => [g.id, g.parent]));
    for (const b of this.books) {
      const gs = new Set(b.genres.flatMap((g) => (parent.has(g) ? [g, parent.get(g)] : [g])));
      gs.forEach((g) => inc(c.genres, g));
      b.themes.forEach((t) => inc(c.themes, t));
      b.warnings.forEach((w) => inc(c.warnings, w));
      inc(c.formats, b.format);
    }
    return c;
  }

  #context() {
    const self = this;
    return {
      vocab: this.vocab, byId: this.byId, counts: this.counts, total: this.books.length, parentName: CONFIG.parentName,
      get pph() { return self.pph; },
      shelfState: (id) => (this.shelf.want.includes(id) ? 'want' : this.shelf.read.includes(id) ? 'read' : this.shelf.nope.includes(id) ? 'nope' : null),
      summaryFor: (id) => this.baked[id] ?? this.summaries.get(id)?.data ?? null,
      summaryState: (id) => this.summaries.get(id),
    };
  }

  signals() {
    const { parsed, dropped, picks, likes } = this.state;
    const pickedKinds = new Set([...picks.values()].filter((p) => SINGLE_KINDS.has(p.kind)).map((p) => p.kind));
    const fromText = parsed.signals.filter((s) => {
      const k = signalKey(s);
      if (dropped.has(k) || picks.has(k)) return false;
      if (SINGLE_KINDS.has(s.kind) && (pickedKinds.has(s.kind) || dropped.has(`${s.kind}:*`))) return false;
      if (s.kind === 'pages' && pickedKinds.has('length')) return false;
      return true;
    });
    const fromLikes = likes.map((id) => ({ kind: 'seed', id, polarity: 1, strength: 1, source: 'like' }));
    return [...fromText, ...picks.values(), ...fromLikes];
  }

  getState(kind, id) {
    const sigs = this.signals();
    if (id === undefined) {
      const s = sigs.find((x) => x.kind === kind);
      return s ? s.id : '';
    }
    const s = sigs.find((x) => x.kind === kind && x.id === id);
    if (!s) return 'off';
    return s.polarity < 0 ? 'avoid' : 'want';
  }

  get hidden() { return new Set([...this.shelf.read, ...this.shelf.nope]); }
  get pph() { return this.shelf.pph ?? CONFIG.defaultPagesPerHour; }

  /* ---------- update / render ---------- */

  update({ reparse = false, keepShown = false } = {}) {
    if (reparse) {
      this.state.parsed = parseIntent(this.state.text, { lexicon: this.lexicon, books: this.books, strategies: this.state.strategies });
    }
    if (!keepShown) this.state.shown = CONFIG.pageSize;
    const signals = this.signals();
    this.result = this.rec.recommend(signals, { hidden: this.hidden, limit: 40, shuffle: this.state.shuffle });

    const typed = hasContent(this.state.text);
    mount($('#understood'), V.understandingView(this.ctx, {
      signals, states: this.state.parsed.states, strategies: this.state.strategies, typed,
      understood: this.state.parsed.signals.length > 0,
    }));
    this.renderPicker();
    this.renderResults();
    this.#writeHash();
    const first = this.result.items[0];
    if (first && this.result.hasQuery) this.ensureSummary(first.book);
  }

  renderPicker() {
    mount($('#picker-body'), V.pickerView(this.ctx, (k, id) => this.getState(k, id), { showAllThemes: this.state.showAllThemes }));
    const n = [...this.state.picks.values()].length;
    $('#picker-count').textContent = n ? `${fa(n)} انتخاب` : '';
  }

  renderResults() {
    mount($('#results'), V.resultsView(this.result, this.ctx, { pageSize: CONFIG.pageSize, shown: this.state.shown }));
  }

  /* ---------- actions ---------- */

  cycle(kind, id) {
    const key = `${kind}:${id}`;
    const current = this.getState(kind, id);
    const next = current === 'off' ? 'want' : current === 'want' ? 'avoid' : 'off';
    this.state.picks.delete(key);
    if (next === 'off') this.state.dropped.add(key);
    else this.state.picks.set(key, { kind, id, polarity: next === 'want' ? 1 : -1, strength: 1, source: 'pick' });
    this.update();
  }

  segment(kind, id) {
    for (const [k, p] of this.state.picks) if (p.kind === kind || (kind === 'length' && p.kind === 'pages')) this.state.picks.delete(k);
    if (id) this.state.picks.set(`${kind}:${id}`, { kind, id, polarity: 1, strength: 1, source: 'pick' });
    else this.state.dropped.add(`${kind}:*`);
    if (kind === 'length') this.state.dropped.add('pages:*');
    this.update();
  }

  drop(key) {
    this.state.picks.delete(key);
    this.state.dropped.add(key);
    const [kind, id] = key.split(':');
    if (kind === 'seed') this.state.likes = this.state.likes.filter((x) => x !== id);
    this.#renderLikes();
    this.update();
  }

  relax(key) {
    const [kind, id] = key.split(':');
    if (kind === 'warning') this.drop(`warning:${id}`);
    else if (kind === 'genre' || kind === 'theme' || kind === 'mood') this.drop(`${kind}:${id}`);
    else if (kind === 'translated') this.segment('translated', '');
    else if (kind === 'audience') this.segment('audience', '');
    else if (kind === 'pages') { this.state.dropped.add('pages:*'); for (const s of this.state.parsed.signals) if (s.kind === 'pages') this.state.dropped.add(signalKey(s)); this.segment('length', ''); }
    this.toast('یکی از محدودیت‌ها برداشته شد.');
  }

  reset() {
    Object.assign(this.state, { text: '', dropped: new Set(), picks: new Map(), strategies: {}, likes: [], shuffle: 0 });
    $('#composer-input').value = '';
    this.#renderLikes();
    this.update({ reparse: true });
  }

  toggleShelf(list, id) {
    const inList = this.shelf[list].includes(id);
    for (const l of ['want', 'read', 'nope']) this.shelf[l] = this.shelf[l].filter((x) => x !== id);
    if (!inList) this.shelf[list].unshift(id);
    this.#saveShelf();
    const title = this.byId.get(id)?.title ?? '';
    if (!inList && list === 'nope') this.toast(`«${title}» دیگه پیشنهاد نمی‌شه.`, { action: 'برگردون', run: () => this.toggleShelf('nope', id) });
    else if (!inList && list === 'read') this.toast(`«${title}» رفت تو «خوندم».`, { action: 'برگردون', run: () => this.toggleShelf('read', id) });
    else if (!inList && list === 'want') this.toast(`«${title}» به فهرست «می‌خوام بخونم» اضافه شد.`);
    this.update({ keepShown: true });
    if ($('#sheet').open && this.openId) this.renderSheet();
    if ($('#shelf').open) this.renderShelf();
  }

  /* ---------- summaries ---------- */

  async ensureSummary(book) {
    const current = this.summaries.get(book.id);
    if (current && current.status !== 'idle') return current;
    const done = (data) => {
      const st = data ? { status: 'ok', data, ...leadSentences(data.text, 3) } : { status: 'none' };
      this.summaries.set(book.id, st);
      this.#refreshSummary(book.id);
      return st;
    };
    if (book.summary) return done({ text: book.summary, lang: 'fa', source: '' });
    if (this.baked[book.id]?.text) return done(this.baked[book.id]);
    const cached = storage.get(`sum:${book.id}`);
    if (cached && Date.now() - cached.at < CONFIG.summaryCacheDays * 864e5) return done(cached.data);
    if (!CONFIG.liveSummaries) return done(null);
    this.summaries.set(book.id, { status: 'loading' });
    this.#refreshSummary(book.id);
    const data = await lookupSummary(book, { googleApiKey: CONFIG.googleBooksApiKey });
    if (data) storage.set(`sum:${book.id}`, { at: Date.now(), data });
    return done(data);
  }

  #refreshSummary(id) {
    const node = $(`[data-summary-for="${CSS.escape(id)}"]`);
    if (node) mount(node, V.summaryPreview(this.summaries.get(id)));
    if ($('#sheet').open && this.openId === id) mount($('.sheet__summary'), V.sheetSummary(this.summaries.get(id), this.expanded));
  }

  /* ---------- dialogs ---------- */

  openBook(id) {
    if (!this.byId.has(id)) return;
    this.openId = id;
    this.expanded = false;
    this.renderSheet();
    const dlg = $('#sheet');
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    $('.sheet__scroll', dlg).scrollTop = 0;
    this.#writeHash();
    this.ensureSummary(this.byId.get(id));
  }

  renderSheet() {
    const book = this.byId.get(this.openId);
    const item = this.result?.items.find((it) => it.book.id === this.openId);
    mount($('#sheet-body'), V.sheetView(book, this.ctx, {
      item, similar: this.rec.similarTo(book.id, { limit: 6, hidden: this.hidden }),
      summary: this.summaries.get(book.id), expanded: this.expanded,
    }));
  }

  openShelf(tab = this.shelfTab ?? 'want') {
    this.shelfTab = tab;
    this.renderShelf();
    if (!$('#shelf').open) $('#shelf').showModal();
  }

  renderShelf() {
    mount($('#shelf-body'), V.shelfView(this.ctx, { tab: this.shelfTab, lists: this.shelf, pph: this.pph }));
  }

  openSurprise() {
    this.surpriseBook = this.rec.surprise(this.signals(), { hidden: this.hidden, seed: Date.now() & 0xffffffff });
    this.revealed = false;
    this.renderSurprise();
    if (!$('#surprise').open) $('#surprise').showModal();
  }

  renderSurprise() {
    mount($('#surprise-body'), V.surpriseView(this.surpriseBook, this.ctx, { revealed: this.revealed }));
  }

  /* ---------- like-a-book mode ---------- */

  #likeMatches(query) {
    const q = normalize(query, { stripPunctuation: true });
    if (q.length < 2) return [];
    const scored = [];
    for (const b of this.books) {
      if (this.state.likes.includes(b.id)) continue;
      const hay = b._haystack;
      const idx = hay.indexOf(q);
      if (idx >= 0) scored.push([b, idx === 0 ? 0 : 1]);
    }
    return scored.sort((a, b) => a[1] - b[1]).slice(0, 6).map(([b]) => b);
  }

  #renderLikeOptions() {
    const list = $('#like-options');
    const items = this.#likeMatches($('#like-input').value);
    this.likeActive = 0;
    list.hidden = items.length === 0;
    mount(list, html`${items.map((b, i) => html`<li role="option" id="like-opt-${i}" data-id="${b.id}" aria-selected="${i === 0}"><strong>${b.title}</strong><small>${b.author}</small></li>`)}`);
    $('#like-input').setAttribute('aria-expanded', String(items.length > 0));
  }

  addLike(id) {
    if (!this.state.likes.includes(id)) this.state.likes.push(id);
    $('#like-input').value = '';
    $('#like-options').hidden = true;
    this.#renderLikes();
    this.update();
  }

  #renderLikes() {
    mount($('#like-chosen'), html`${this.state.likes.map((id) => html`<span class="tag">${this.byId.get(id)?.title}<button type="button" class="tag__x" data-act="drop" data-key="seed:${id}" aria-label="حذف">${icon('close', { size: 14 })}</button></span>`)}`);
  }

  setMode(mode) {
    this.state.mode = mode;
    $$('[data-act="mode"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('#panel-write').hidden = mode !== 'write';
    $('#panel-like').hidden = mode !== 'like';
    (mode === 'write' ? $('#composer-input') : $('#like-input')).focus();
  }

  /* ---------- persistence ---------- */

  #loadShelf() {
    const s = storage.get('shelf', null);
    if (s && typeof s === 'object') {
      for (const l of ['want', 'read', 'nope']) this.shelf[l] = Array.isArray(s[l]) ? s[l].filter((x) => typeof x === 'string') : [];
      if ([25, 40, 60].includes(s.pph)) this.shelf.pph = s.pph;
    }
  }

  #saveShelf() {
    storage.set('shelf', this.shelf);
    this.#updateShelfBadge();
  }

  #updateShelfBadge() {
    const n = this.shelf.want.filter((id) => this.byId.has(id)).length;
    const badge = $('#shelf-count');
    badge.textContent = n ? fa(n) : '';
    badge.hidden = !n;
  }

  #writeHash() {
    const p = new URLSearchParams();
    if (this.state.text.trim()) p.set('q', this.state.text.trim());
    const picks = [...this.state.picks.values()].map((s) => `${s.polarity < 0 ? '-' : ''}${s.kind}.${s.id}`);
    if (picks.length) p.set('p', picks.join(','));
    if (this.state.likes.length) p.set('l', this.state.likes.join(','));
    const st = Object.entries(this.state.strategies).map(([k, v]) => `${k}.${v}`);
    if (st.length) p.set('st', st.join(','));
    if ($('#sheet').open && this.openId) p.set('b', this.openId);
    const hash = p.toString();
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  }

  #restoreFromHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    this.state.text = p.get('q') ?? '';
    $('#composer-input').value = this.state.text;
    for (const token of (p.get('p') ?? '').split(',').filter(Boolean)) {
      const neg = token.startsWith('-');
      const [kind, ...rest] = token.replace(/^-/, '').split('.');
      const id = rest.join('.');
      if (kind && id) this.state.picks.set(`${kind}:${id}`, { kind, id, polarity: neg ? -1 : 1, strength: 1, source: 'pick' });
    }
    this.state.likes = (p.get('l') ?? '').split(',').filter((id) => this.byId.has(id));
    for (const token of (p.get('st') ?? '').split(',').filter(Boolean)) {
      const [k, v] = token.split('.');
      if (v === 'lift' || v === 'match') this.state.strategies[k] = v;
    }
    this.#renderLikes();
  }

  /* ---------- UI plumbing ---------- */

  toast(message, { action, run } = {}) {
    const box = $('#toast');
    clearTimeout(this.toastTimer);
    mount(box, html`<span>${message}</span>${action ? html`<button type="button" class="link-btn" data-act="toast-action">${action}</button>` : ''}`);
    box.hidden = false;
    this.toastRun = run;
    this.toastTimer = setTimeout(() => { box.hidden = true; }, action ? 6000 : 3200);
  }

  async copy(text, message) {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ url: text }); return; }
      await navigator.clipboard.writeText(text);
      this.toast(message);
    } catch {
      prompt('این لینک رو کپی کن:', text);
    }
  }

  #renderExamples() {
    const pick = [...EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 4);
    mount($('#examples'), html`<span class="examples__lead">مثلاً</span>${pick.map((t) => html`<button type="button" class="example" data-act="example">${t}</button>`)}`);
  }

  #bindBackdrop() {
    const root = document.documentElement;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ticking = false;
    const apply = () => {
      ticking = false;
      const p = Math.min(1, window.scrollY / (window.innerHeight * 0.9));
      root.style.setProperty('--veil', p.toFixed(3));
      if (!reduce) root.style.setProperty('--drift', `${(window.scrollY * -0.08).toFixed(1)}px`);
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(apply); } }, { passive: true });
    apply();
  }

  #bindEvents() {
    const input = $('#composer-input');
    const live = debounce(() => this.update({ reparse: true }), 420);
    input.addEventListener('input', () => { this.state.text = input.value; this.state.dropped = new Set(); live(); });
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      this.state.text = input.value;
      this.update({ reparse: true });
      $('#understood').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
    });

    const likeInput = $('#like-input');
    likeInput.addEventListener('input', () => this.#renderLikeOptions());
    likeInput.addEventListener('keydown', (e) => {
      const opts = $$('#like-options [role="option"]');
      if (!opts.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.likeActive = (this.likeActive + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
        opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === this.likeActive)));
        likeInput.setAttribute('aria-activedescendant', opts[this.likeActive].id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.addLike(opts[this.likeActive].dataset.id);
      } else if (e.key === 'Escape') $('#like-options').hidden = true;
    });
    on($('#like-options'), 'mousedown', '[role="option"]', (e, el) => { e.preventDefault(); this.addLike(el.dataset.id); });

    on(document, 'click', '[data-act]', (e, el) => this.#act(e, el));
    on(document, 'change', '[data-act]', (e, el) => {
      const act = el.dataset.act;
      if (act === 'translated') this.segment('translated', el.checked ? 'yes' : '');
      if (act === 'pph') { this.shelf.pph = Number(el.value); this.#saveShelf(); this.update({ keepShown: true }); this.renderShelf(); }
      if (act === 'import') this.#import(el.files?.[0]);
    });

    for (const dlg of $$('dialog')) {
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener('close', () => { if (dlg.id === 'sheet') { this.openId = null; this.#writeHash(); } });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName ?? '') && !$('dialog[open]')) {
        e.preventDefault();
        this.setMode('write');
      }
    });
  }

  #act(e, el) {
    const { act, id, kind } = el.dataset;
    switch (act) {
      case 'cycle': return this.cycle(kind, id);
      case 'segment': return this.segment(kind, id);
      case 'warning': {
        const key = `warning:${id}`;
        if (this.getState('warning', id) === 'avoid') { this.state.picks.delete(key); this.state.dropped.add(key); }
        else this.state.picks.set(key, { kind: 'warning', id, polarity: -1, strength: 1, source: 'pick' });
        return this.update();
      }
      case 'more-themes': this.state.showAllThemes = !this.state.showAllThemes; return this.renderPicker();
      case 'drop': return this.drop(el.dataset.key);
      case 'reset': return this.reset();
      case 'relax': return this.relax(el.dataset.key);
      case 'strategy': this.state.strategies[el.dataset.stateId] = el.dataset.strategy; return this.update({ reparse: true });
      case 'example': {
        $('#composer-input').value = el.textContent.trim();
        this.state.text = el.textContent.trim();
        this.state.dropped = new Set();
        this.setMode('write');
        this.update({ reparse: true });
        return $('#understood').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      case 'mode': return this.setMode(el.dataset.mode);
      case 'shuffle': this.state.shuffle = (this.state.shuffle % 997) + 1; this.update(); return $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
      case 'more': this.state.shown += CONFIG.pageSize; return this.renderResults();
      case 'share': return this.copy(location.href, 'لینک این جست‌وجو کپی شد.');
      case 'open': e.preventDefault(); return this.openBook(id);
      case 'shelf': return this.toggleShelf(el.dataset.list, id);
      case 'unshelf': for (const l of ['want', 'read', 'nope']) this.shelf[l] = this.shelf[l].filter((x) => x !== id); this.#saveShelf(); this.renderShelf(); return this.update({ keepShown: true });
      case 'shelf-tab': this.shelfTab = el.dataset.tab; return this.renderShelf();
      case 'open-shelf': return this.openShelf();
      case 'export': return this.#export();
      case 'pick': {
        $('#sheet').close();
        this.state.picks.set(`${kind}:${id}`, { kind, id, polarity: 1, strength: 1, source: 'pick' });
        this.update();
        return $('#understood').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      case 'like-this': {
        $('#sheet').close();
        $('#surprise').close();
        this.state.likes = [id];
        this.#renderLikes();
        this.setMode('like');
        this.update();
        return $('#understood').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      case 'copy-book': {
        const url = new URL(location.href);
        url.hash = `b=${id}`;
        return this.copy(url.toString(), 'لینک کتاب کپی شد.');
      }
      case 'expand-summary': this.expanded = !this.expanded; return mount($('.sheet__summary'), V.sheetSummary(this.summaries.get(this.openId), this.expanded));
      case 'surprise': return this.openSurprise();
      case 'reveal': this.revealed = true; return this.renderSurprise();
      case 'another': return this.openSurprise();
      case 'close': return el.closest('dialog')?.close();
      case 'toast-action': $('#toast').hidden = true; return this.toastRun?.();
      default: return undefined;
    }
  }

  #export() {
    const blob = new Blob([JSON.stringify({ app: 'chi-bekhoonam', version: 2, shelf: this.shelf }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chi-bekhoonam-shelf.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async #import(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const s = data?.shelf;
      if (!s) throw new Error('bad file');
      for (const l of ['want', 'read', 'nope']) this.shelf[l] = [...new Set([...(s[l] ?? []), ...this.shelf[l]])].filter((x) => typeof x === 'string');
      this.#saveShelf();
      this.renderShelf();
      this.update({ keepShown: true });
      this.toast('قفسه برگردونده شد.');
    } catch {
      this.toast('این فایل پشتیبان قفسه نیست.');
    }
  }
}

const app = new App();
window.addEventListener('DOMContentLoaded', () => app.start());

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
