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
import { shardOf, shardName } from './core/shard.js';
import { installCoverFallbacks, coverSources, palette } from './services/covers.js';
import { tonightPick, nightLabel } from './features/tonight.js';
import { signalKey } from './ui/labels.js';
import { fa, readingTime, listFa } from './ui/format.js';
import { icon } from './ui/icons.js';
import * as V from './ui/views.js';

const SINGLE_KINDS = new Set(['length', 'pages', 'chapters', 'volumes', 'pace', 'darkness', 'complexity', 'audience', 'translated', 'status']);
const EASTERN_HINT_RE = /(شیان\s*شیا|شوان\s*هوان|ووشیا|موریم|ایسکای|لایت\s*ناول|وب\s*ناول|دنمی|اوتومه|دونگهوا|مانهوا|رگرسیون|کالتیویشن|تزکیه|سولو\s*لولینگ|ارباب\s*اسرار|دیدگاه\s*خواننده|جنون\s*کشیش|موشوکو|کونوسوبا|\b(?:lotm|orv|mdzs|tgcf|xianxia|xuanhuan|wuxia|murim|isekai|danmei|manhwa|donghua|litrpg|webnovel|light novel)\b)/i;

const SECTIONS = {
  books: {
    heroTitle: 'امشب دلت چه داستانی می‌خواد؟',
    heroLead: 'همون‌طور که به یه دوست کتاب‌خون می‌گی بنویس: حس‌وحالت، چقدر وقت داری، یا کتابی که دوستش داشتی.',
    placeholder: 'مثلاً: یه چیز رازآلود و دنج برای شب‌های پاییز، نه خیلی طولانی…',
    likeTab: 'از روی کتابی که دوست داشتم',
    likePlaceholder: 'اسم کتاب یا نویسنده‌ای که دوستش داشتی…',
    likeHint: 'می‌تونی چندتا کتاب اضافه کنی؛ پیشنهادها از ترکیبشون درمیاد.',
    pickerHint: 'حس‌وحال، ژانر، حجم، ریتم و…',
    surpriseTitle: 'قرار با یه کتاب ناشناس',
    examples: [
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
    ],
  },
  novels: {
    heroTitle: 'امشب دلت چه ناول شرقی می‌خواد؟',
    heroLead: 'بنویس دنبال چه دنیایی هستی: شیان‌شیا، موریم، ایسکای، سیستم و دانجن، چینی یا کره‌ای، تموم‌شده یا شبیه ناولی که دوستش داشتی.',
    placeholder: 'مثلاً: یه شیان‌شیای تاریک با شخصیت اصلی باهوش، پایان‌یافته…',
    likeTab: 'از روی ناولی که دوست داشتم',
    likePlaceholder: 'اسم ناول، مخفف (مثل LOTM یا ORV) یا نویسنده…',
    likeHint: 'می‌تونی چندتا ناول اضافه کنی؛ پیشنهادها از ترکیبشون درمیاد.',
    pickerHint: 'خاستگاه، ژانر شرقی، وضعیت، حجم، اقتباس و…',
    surpriseTitle: 'قرار با یه ناول ناشناس',
    examples: [
      'یه شیان‌شیای تاریک با شخصیت اصلی باهوش',
      'شبیه ارباب اسرار، ولی کوتاه‌تر',
      'کره‌ای با سیستم و دانجن، پایان‌یافته',
      'موریم پرهیجان و خنده‌دار',
      'ایسکای ژاپنی دنج و بدون خشونت',
      'مثل سولو لولینگ، مانهوا داشته باشه',
      'ناول چینی معمایی و وهم‌آلود',
      'دلم گرفته؛ یه برش زندگی ژاپنی آروم',
      'ضدقهرمان بی‌رحم و استراتژیست',
      'بازگشت در زمان و انتقام، زیر ۵۰۰ چپتر',
    ],
  },
};

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
  section = 'books';
  catalogs = { books: null, novels: null };
  allById = new Map();
  allCovers = {};
  state = {
    text: '', parsed: { signals: [], states: [] }, dropped: new Set(), picks: new Map(), strategies: {},
    likes: [], shuffle: 0, shown: CONFIG.pageSize, showAllThemes: false, mode: 'write',
  };

  shelf = { want: [], read: [], nope: [] };
  summaries = new Map();
  covers = {};
  shards = new Map();

  async start() {
    installCoverFallbacks(document);
    this.#bindBackdrop();
    try {
      const [booksText, vocabText, coversText, feedText] = await Promise.all([
        fetchText(CONFIG.booksUrl), fetchText(CONFIG.vocabUrl),
        fetchText(CONFIG.coversUrl, { optional: true }), fetchText(CONFIG.feedUrl, { optional: true }),
      ]);
      this.catalogs.books = this.#buildSection(CONFIG.booksUrl, booksText, vocabText, coversText, CONFIG.summariesDir);
      this.feed = feedText ? JSON.parse(feedText) : [];
    } catch (err) {
      console.error(err);
      mount($('#results'), html`<div class="empty"><h2 class="display">فهرست کتاب‌ها باز نشد</h2><p>اینترنتت رو چک کن و صفحه رو دوباره باز کن.</p></div>`);
      document.body.classList.remove('is-loading');
      return;
    }

    this.#loadShelf();
    const initialHash = new URLSearchParams(location.hash.slice(1));
    const wantSection = initialHash.get('s') === 'novels' ? 'novels' : 'books';
    const hashBook = initialHash.get('b');
    let startSection = wantSection;
    if (wantSection === 'novels' || (hashBook && !this.catalogs.books.byId.has(hashBook))) {
      const loaded = await this.ensureNovels();
      if (loaded && (wantSection === 'novels' || loaded.byId.has(hashBook))) startSection = 'novels';
    }

    this.#activateSection(startSection);
    this.#restoreFromHash();
    this.#bindEvents();
    mount($('#feed'), V.feedView(this.feed, this.ctx));
    $('#feed').hidden = !this.feed?.length;
    this.#updateShelfBadge();
    this.update({ reparse: true });
    document.body.classList.remove('is-loading');

    if (hashBook && this.byId.has(hashBook)) this.openBook(hashBook);
    else if (initialHash.has('tonight') && this.tonight) this.openBook(this.tonight.id);
  }

  #buildSection(url, dataText, vocabText, coversText, summariesDir) {
    const vocab = buildVocab(JSON.parse(vocabText));
    const { books, issues } = buildCatalog(parseBooksFile(url, dataText), vocab);
    if (issues.length) console.warn(`${url}: ${issues.length} مورد قابل بررسی`, issues);
    const byId = new Map(books.map((b) => [b.id, b]));
    const covers = coversText ? JSON.parse(coversText) : {};
    for (const b of books) this.allById.set(b.id, b);
    Object.assign(this.allCovers, covers);
    const rec = new Recommender(books, vocab);
    const lexicon = compileLexicon(vocab);
    const counts = this.#counts(books, vocab);
    const tonight = tonightPick(books);
    return { books, byId, vocab, rec, lexicon, counts, covers, tonight, shards: new Map(), summariesDir };
  }

  async ensureNovels() {
    if (this.catalogs.novels) return this.catalogs.novels;
    if (this.novelsPromise) return this.novelsPromise;
    this.novelsPromise = (async () => {
      try {
        const [novelsText, vocabText, coversText] = await Promise.all([
          fetchText(CONFIG.novelsUrl), fetchText(CONFIG.novelsVocabUrl),
          fetchText(CONFIG.novelCoversUrl, { optional: true }),
        ]);
        this.catalogs.novels = this.#buildSection(CONFIG.novelsUrl, novelsText, vocabText, coversText, CONFIG.novelSummariesDir);
        this.#updateShelfBadge();
        return this.catalogs.novels;
      } catch (err) {
        console.error(err);
        this.toast('فهرست ناول‌های شرقی باز نشد؛ اینترنتت رو چک کن.');
        return null;
      } finally {
        this.novelsPromise = null;
      }
    })();
    return this.novelsPromise;
  }

  #activateSection(sec) {
    const cat = this.catalogs[sec];
    if (!cat) return;
    this.section = sec;
    this.vocab = cat.vocab;
    this.books = cat.books;
    this.byId = cat.byId;
    this.covers = cat.covers;
    this.rec = cat.rec;
    this.lexicon = cat.lexicon;
    this.counts = cat.counts;
    this.tonight = cat.tonight;
    this.shards = cat.shards;
    this.summariesDir = cat.summariesDir;
    this.ctx = this.#context();

    document.body.dataset.section = sec;
    $$('[data-act="section"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.section === sec)));
    const copy = SECTIONS[sec];
    $('#hero-title').textContent = copy.heroTitle;
    $('#hero-lead').textContent = copy.heroLead;
    $('#composer-input').placeholder = copy.placeholder;
    $('#tab-like').textContent = copy.likeTab;
    $('#like-input').placeholder = copy.likePlaceholder;
    $('#like-hint').textContent = copy.likeHint;
    $('#picker-hint').textContent = copy.pickerHint;
    $('#surprise-title').textContent = copy.surpriseTitle;
    this.#renderExamples();
    mount($('#tonight'), V.tonightView(this.tonight, this.ctx, { label: nightLabel() }));
  }

  async switchSection(sec, { keepText = false } = {}) {
    if (sec === this.section) return;
    if (sec === 'novels' && !this.catalogs.novels) {
      document.body.classList.add('is-loading');
      const loaded = await this.ensureNovels();
      document.body.classList.remove('is-loading');
      if (!loaded) return;
    }
    const prevText = keepText ? this.state.text : '';
    Object.assign(this.state, { text: prevText, dropped: new Set(), picks: new Map(), strategies: {}, likes: [], shuffle: 0, showAllThemes: false });
    $('#composer-input').value = prevText;
    $('#like-input').value = '';
    $('#like-options').hidden = true;
    this.#activateSection(sec);
    this.#renderLikes();
    this.update({ reparse: true });
  }

  /* ---------- derived data ---------- */

  #counts(books, vocab) {
    const c = { genres: new Map(), themes: new Map(), warnings: new Map(), formats: new Map(), origins: new Map(), statuses: new Map(), adaptations: new Map() };
    const inc = (m, k) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
    const parent = new Map(vocab.genres.list.filter((g) => g.parent).map((g) => [g.id, g.parent]));
    for (const b of books) {
      const gs = new Set(b.genres.flatMap((g) => (parent.has(g) ? [g, parent.get(g)] : [g])));
      gs.forEach((g) => inc(c.genres, g));
      b.themes.forEach((t) => inc(c.themes, t));
      b.warnings.forEach((w) => inc(c.warnings, w));
      (b.adaptations ?? []).forEach((a) => inc(c.adaptations, a));
      inc(c.formats, b.format);
      inc(c.origins, b.origin);
      inc(c.statuses, b.status);
    }
    return c;
  }

  #context() {
    const self = this;
    return {
      section: this.section, vocab: this.vocab, byId: this.byId, allById: this.allById, counts: this.counts, total: this.books.length, parentName: CONFIG.parentName,
      get pph() { return self.pph; },
      shelfState: (id) => (this.shelf.want.includes(id) ? 'want' : this.shelf.read.includes(id) ? 'read' : this.shelf.nope.includes(id) ? 'nope' : null),
      // Cards only need the cover; the full summary arrives when an item is opened.
      summaryFor: (id) => this.summaries.get(id)?.data ?? (this.allCovers[id] ? { cover: this.allCovers[id] } : null),
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
      if ((s.kind === 'pages' || s.kind === 'chapters' || s.kind === 'volumes') && pickedKinds.has('length')) return false;
      return true;
    });
    const fromLikes = likes.map((id) => ({ kind: 'seed', id, polarity: 1, strength: 1, source: 'like' }));
    return [...fromText, ...picks.values(), ...fromLikes];
  }

  getState(kind, id) {
    const sigs = this.signals();
    if (id === undefined) {
      const s = sigs.find((x) => x.kind === kind && (x.polarity ?? 1) > 0);
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
    const suggestNovels = this.section === 'books' && typed && EASTERN_HINT_RE.test(normalize(this.state.text));
    mount($('#understood'), V.understandingView(this.ctx, {
      signals, states: this.state.parsed.states, strategies: this.state.strategies, typed,
      understood: this.state.parsed.signals.length > 0, suggestNovels,
    }));
    this.renderPicker();
    this.renderResults();
    $('#tonight').hidden = !this.tonight || this.result.hasQuery;
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
    for (const [k, p] of this.state.picks) if (p.kind === kind || (kind === 'length' && (p.kind === 'pages' || p.kind === 'chapters' || p.kind === 'volumes'))) this.state.picks.delete(k);
    if (id) this.state.picks.set(`${kind}:${id}`, { kind, id, polarity: 1, strength: 1, source: 'pick' });
    else this.state.dropped.add(`${kind}:*`);
    if (kind === 'length') { this.state.dropped.add('pages:*'); this.state.dropped.add('chapters:*'); this.state.dropped.add('volumes:*'); }
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
    const clearKind = (k) => {
      for (const [pk, p] of this.state.picks) if (p.kind === k) this.state.picks.delete(pk);
      this.state.dropped.add(`${k}:*`);
      for (const s of this.state.parsed.signals) if (s.kind === k) this.state.dropped.add(signalKey(s));
    };
    if (kind === 'warning') this.drop(`warning:${id}`);
    else if (id && ['genre', 'theme', 'mood', 'origin', 'status', 'adaptation'].includes(kind)) this.drop(`${kind}:${id}`);
    else if (['origin', 'status', 'adaptation'].includes(kind)) { clearKind(kind); this.update(); }
    else if (kind === 'translated') this.segment('translated', '');
    else if (kind === 'audience') this.segment('audience', '');
    else if (kind === 'pages' || kind === 'chapters' || kind === 'volumes') { clearKind(kind); this.segment('length', ''); }
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
    const title = this.allById.get(id)?.title ?? '';
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
    this.summaries.set(book.id, { status: 'loading' });
    const baked = await this.#bakedSummary(book.id);
    if (baked?.text) return done(baked);
    const cached = storage.get(`sum:${book.id}`);
    if (cached && Date.now() - cached.at < CONFIG.summaryCacheDays * 864e5) return done(cached.data);
    if (!CONFIG.liveSummaries) return done(null);
    this.summaries.set(book.id, { status: 'loading' });
    this.#refreshSummary(book.id);
    const data = await lookupSummary(book, { googleApiKey: CONFIG.googleBooksApiKey });
    if (data) storage.set(`sum:${book.id}`, { at: Date.now(), data });
    return done(data);
  }

  /** Loads the summaries file that holds this book/novel (each file holds ~1/64 of its catalog). */
  #bakedSummary(id) {
    const n = shardOf(id);
    if (!this.shards.has(n)) {
      this.shards.set(n, fetchText(`${this.summariesDir}${shardName(n)}`, { optional: true })
        .then((t) => (t ? JSON.parse(t) : {}))
        .catch(() => ({})));
    }
    return this.shards.get(n).then((map) => map[id] ?? null);
  }

  #refreshSummary(id) {
    const node = $(`[data-summary-for="${CSS.escape(id)}"]`);
    if (node) mount(node, V.summaryPreview(this.summaries.get(id)));
    if ($('#sheet').open && this.openId === id) mount($('.sheet__summary'), V.sheetSummary(this.summaries.get(id), this.expanded));
  }

  /* ---------- story card ---------- */

  async storyCard(id, source) {
    const book = this.byId.get(id);
    if (!book) return;
    const isNovel = Boolean(book.origin);
    const text = this.state.text.trim();
    const quote = source === 'pick' && text && text.length <= 90 ? text : '';
    const kicker = source === 'tonight'
      ? `${isNovel ? 'ناول امشب' : 'کتاب امشب'} · ${nightLabel()}`
      : quote ? 'امشب حالم این بود:' : (isNovel ? 'ناول امشب من' : 'کتاب امشب من');
    const link = new URL(location.href);
    link.hash = isNovel ? `s=novels&b=${id}` : `b=${id}`;
    const meta = isNovel
      ? [
        this.vocab.origins?.byId.get(book.origin)?.label,
        book.status ? this.vocab.statuses?.byId.get(book.status)?.label : '',
        book.chapters ? `${fa(book.chapters.toLocaleString('en-US'))} چپتر` : (book.volumes ? `${fa(book.volumes)} جلد` : ''),
        book.year ? fa(book.year) : '',
      ].filter(Boolean).join(' · ')
      : [book.pages ? `${fa(book.pages)} صفحه` : '', book.pages ? readingTime(book.pages, this.pph) : '', book.year ? fa(book.year) : ''].filter(Boolean).join(' · ');
    const card = {
      id, kicker, quote,
      title: book.title.replace(/\s*\(.*\)\s*/, ''),
      author: book.author,
      translators: isNovel ? '' : listFa(book.translators.slice(0, 2)),
      chips: book.moods.slice(0, 3).map((m) => this.vocab.moods.byId.get(m)?.label ?? m),
      meta,
      coverSources: coverSources(book, this.ctx.summaryFor(id)),
      palette: palette(book),
      backdrop: 'assets/img/hero-night-mobile.webp',
      url: location.host || 'chi.faragomancb.ir',
      shareText: `«${book.title}» از ${book.author} — ${kicker.replace(/:$/, '')}\n${link}`,
    };
    const { openStoryCard } = await import('./features/story.js');
    openStoryCard(card, { toast: (m) => this.toast(m) });
  }

  /* ---------- dialogs ---------- */

  async openBook(id) {
    if (!this.byId.has(id)) {
      if (this.section === 'books') {
        const loaded = await this.ensureNovels();
        if (loaded?.byId.has(id)) await this.switchSection('novels');
      } else if (this.catalogs.books?.byId.has(id)) {
        await this.switchSection('books');
      }
    }
    if (!this.byId.has(id)) return;
    if ($('#shelf').open) $('#shelf').close();
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

  async openShelf(tab = this.shelfTab ?? 'want') {
    this.shelfTab = tab;
    const allSaved = [...this.shelf.want, ...this.shelf.read, ...this.shelf.nope];
    if (!this.catalogs.novels && allSaved.some((id) => !this.allById.has(id))) {
      await this.ensureNovels();
    }
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
    const n = this.catalogs.novels
      ? this.shelf.want.filter((id) => this.allById.has(id)).length
      : this.shelf.want.length;
    const badge = $('#shelf-count');
    badge.textContent = n ? fa(n) : '';
    badge.hidden = !n;
  }

  #writeHash() {
    const p = new URLSearchParams();
    if (this.section === 'novels') p.set('s', 'novels');
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
    const list = SECTIONS[this.section].examples;
    const pick = [...list].sort(() => Math.random() - 0.5).slice(0, 4);
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
      case 'section': return this.switchSection(el.dataset.section);
      case 'jump-novels': return this.switchSection('novels', { keepText: true });
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
        url.hash = this.section === 'novels' ? `s=novels&b=${id}` : `b=${id}`;
        return this.copy(url.toString(), this.section === 'novels' ? 'لینک ناول کپی شد.' : 'لینک کتاب کپی شد.');
      }
      case 'expand-summary': this.expanded = !this.expanded; return mount($('.sheet__summary'), V.sheetSummary(this.summaries.get(this.openId), this.expanded));
      case 'story': return this.storyCard(id, kind);
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
