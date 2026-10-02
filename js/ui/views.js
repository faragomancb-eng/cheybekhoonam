/**
 * Pure view functions: data in, escaped markup out. No state, no side effects.
 */
import { html, raw } from '../core/dom.js';

const LTR = raw('dir="ltr" lang="en"');
import { icon } from './icons.js';
import { coverView } from '../services/covers.js';
import { fa, readingTime, readingPlan, listFa } from './format.js';
import { signalKey, signalLabel, FIT_LABELS, relaxLabel } from './labels.js';
import { READER_STATES } from '../engine/states.js';

/* ---------- Picker ---------- */

const SEGMENTS = [
  { kind: 'length', title: 'حجم', options: [['', 'فرقی نداره'], ['short', 'کوتاه'], ['medium', 'متوسط'], ['long', 'بلند']] },
  { kind: 'pace', title: 'ریتم', options: [['', 'فرقی نداره'], ['slow', 'آرام'], ['steady', 'متعادل'], ['fast', 'تند']] },
  { kind: 'darkness', title: 'تاریکی', options: [['', 'فرقی نداره'], ['light', 'روشن'], ['not-dark', 'نه خیلی تاریک'], ['dark', 'تاریک']] },
  { kind: 'complexity', title: 'خوندنش', options: [['', 'فرقی نداره'], ['easy', 'روان و سبک'], ['deep', 'عمیق و چالشی']] },
  { kind: 'audience', title: 'برای', options: [['', 'همه'], ['adult', 'بزرگسال'], ['ya', 'نوجوان']] },
];

function triChip(kind, entry, state, count) {
  const word = state === 'want' ? 'می‌خوام' : state === 'avoid' ? 'نمی‌خوام' : 'فرقی نداره';
  return html`<button type="button" class="chip" data-act="cycle" data-kind="${kind}" data-id="${entry.id}" data-state="${state}"
    aria-label="${entry.label}: ${word}">
    ${state === 'want' ? icon('check', { size: 16 }) : state === 'avoid' ? icon('nope', { size: 16 }) : ''}
    <span class="chip__text">${entry.label}</span>${count != null ? html`<span class="chip__count">${fa(count)}</span>` : ''}
  </button>`;
}

export function pickerView(ctx, getState, { showAllThemes }) {
  const counts = ctx.counts;
  const themes = showAllThemes ? ctx.vocab.themes.list : ctx.vocab.themes.list.filter((t) => counts.themes.get(t.id)).slice(0, 14);
  const usedThemes = ctx.vocab.themes.list.filter((t) => counts.themes.get(t.id));
  const group = (title, hint, body, cls = '') => html`<fieldset class="pick-group ${cls}"><legend>${title}</legend>${hint ? html`<p class="pick-hint">${hint}</p>` : ''}<div class="chips">${body}</div></fieldset>`;
  return html`
    ${group('حس‌وحال کتاب', 'یک بار بزنی یعنی «می‌خوام»، دوباره بزنی یعنی «نمی‌خوام».', ctx.vocab.moods.list.map((m) => triChip('mood', m, getState('mood', m.id))))}
    ${group('ژانر', '', ctx.vocab.genres.list.filter((g) => counts.genres.get(g.id)).map((g) => triChip('genre', g, getState('genre', g.id), counts.genres.get(g.id))))}
    ${group('مایه‌ها', '', [
      ...themes.map((t) => triChip('theme', t, getState('theme', t.id), counts.themes.get(t.id))),
      usedThemes.length > 14 ? html`<button type="button" class="chip chip--more" data-act="more-themes">${showAllThemes ? 'کمتر' : `همه (${fa(usedThemes.length)})`}</button>` : '',
    ])}
    <div class="segments">
      ${SEGMENTS.map((seg) => {
        const current = getState(seg.kind) ?? '';
        return html`<fieldset class="segment"><legend>${seg.title}</legend><div class="segment__opts" role="radiogroup">
          ${seg.options.map(([id, label]) => html`<button type="button" role="radio" class="segment__opt" data-act="segment" data-kind="${seg.kind}" data-id="${id}" aria-checked="${current === id}">${label}</button>`)}
        </div></fieldset>`;
      })}
      <fieldset class="segment"><legend>زبان</legend>
        <label class="switch"><input type="checkbox" data-act="translated" ${getState('translated') === 'yes' ? 'checked' : ''}><span>فقط کتاب‌هایی که به فارسی ترجمه شده‌اند</span></label>
      </fieldset>
    </div>
    ${group('شکل کتاب', '', ctx.vocab.formats.list.filter((f) => f.id !== 'novel' && counts.formats.get(f.id)).map((f) => triChip('format', f, getState('format', f.id), counts.formats.get(f.id))))}
    ${group('نمی‌خوام داشته باشه', 'این‌ها کاملاً از نتیجه‌ها حذف می‌شن.', ctx.vocab.warnings.list.filter((w) => counts.warnings.get(w.id)).map((w) => {
      const on = getState('warning', w.id) === 'avoid';
      return html`<button type="button" class="chip chip--warn" data-act="warning" data-id="${w.id}" data-state="${on ? 'avoid' : 'off'}" aria-pressed="${on}">${on ? icon('nope', { size: 16 }) : ''}<span class="chip__text">${w.label}</span></button>`;
    }), 'pick-group--warn')}
  `;
}

/* ---------- Understanding bar ---------- */

export function understandingView(ctx, { signals, states, strategies, typed, understood }) {
  const visible = signals.filter((s) => s.source !== 'state');
  if (!visible.length && !states.length) {
    if (typed && !understood) {
      return html`<p class="understood__miss">این یکی رو کامل نفهمیدم. با کلمه‌هایی مثل «تاریک»، «بامزه»، «کوتاه»، «شبیه تل‌ماسه» یا اسم یک نویسنده امتحان کن، یا از گزینه‌های پایین انتخاب کن.</p>`;
    }
    return '';
  }
  return html`
    <div class="understood__row">
      <span class="understood__lead">برداشت من از خواسته‌ت:</span>
      ${states.map((st) => html`<span class="tag tag--state">${READER_STATES[st.id]?.label}</span>`)}
      ${visible.map((s) => html`<span class="tag ${s.polarity < 0 ? 'tag--avoid' : ''}">
        ${s.polarity < 0 && s.kind !== 'warning' ? html`<span class="sr">نه</span>${icon('nope', { size: 14 })}` : ''}
        ${signalLabel(s, ctx)}
        <button type="button" class="tag__x" data-act="drop" data-key="${signalKey(s)}" aria-label="حذف ${signalLabel(s, ctx)}">${icon('close', { size: 14 })}</button>
      </span>`)}
      <button type="button" class="link-btn" data-act="reset">پاک کردن همه</button>
    </div>
    ${states.filter((st) => READER_STATES[st.id]?.ask).map((st) => {
      const def = READER_STATES[st.id];
      const cur = strategies[st.id] ?? 'lift';
      return html`<div class="ask" role="group" aria-label="${def.label}">
        <span>${def.label}. کتاب چی‌کار کنه؟</span>
        <div class="ask__opts">
          ${['lift', 'match'].map((k) => html`<button type="button" class="segment__opt" data-act="strategy" data-state-id="${st.id}" data-strategy="${k}" aria-checked="${cur === k}" role="radio">${def[k].label}</button>`)}
        </div>
      </div>`;
    })}
  `;
}

/* ---------- Results ---------- */

function bookMeta(book, ctx) {
  return [
    book.pages ? `${fa(book.pages)} صفحه` : '',
    book.pages ? readingTime(book.pages, ctx.pph) : '',
    book.year ? fa(book.year) : '',
  ].filter(Boolean).join(' · ');
}

function people(book) {
  const t = book.translators.length ? ` · ترجمه‌ی ${listFa(book.translators)}` : (!book.translated ? ' · ترجمه‌ی فارسی‌اش رو پیدا نکردم' : '');
  return `${book.author}${t}`;
}

export function shelfButtons(book, ctx, { compact = false } = {}) {
  const st = ctx.shelfState(book.id);
  return html`<div class="shelf-actions ${compact ? 'shelf-actions--compact' : ''}">
    <button type="button" class="btn btn--ghost ${st === 'want' ? 'is-on' : ''}" data-act="shelf" data-list="want" data-id="${book.id}" aria-pressed="${st === 'want'}">
      ${icon(st === 'want' ? 'bookmarkFilled' : 'bookmark', { size: 18 })}<span>${st === 'want' ? 'تو فهرستمه' : 'می‌خوام بخونم'}</span></button>
    <button type="button" class="btn btn--ghost ${st === 'read' ? 'is-on' : ''}" data-act="shelf" data-list="read" data-id="${book.id}" aria-pressed="${st === 'read'}">
      ${icon('check', { size: 18 })}<span>خوندمش</span></button>
    <button type="button" class="btn btn--ghost btn--quiet" data-act="shelf" data-list="nope" data-id="${book.id}" title="دیگه پیشنهادش نده">
      ${icon('nope', { size: 18 })}<span>${compact ? 'نه' : 'برام جذاب نیست'}</span></button>
  </div>`;
}

function reasonsLine(item) {
  if (!item.reasons?.length && !item.caveats?.length) return '';
  return html`<p class="why">
    ${item.reasons?.length ? html`<span class="why__plus">${item.reasons.join(' · ')}</span>` : ''}
    ${item.caveats?.length ? html`<span class="why__minus">${item.caveats.join(' · ')}</span>` : ''}
  </p>`;
}

export function cardView(item, ctx) {
  const b = item.book;
  return html`<article class="card" data-book="${b.id}">
    <button type="button" class="card__cover" data-act="open" data-id="${b.id}" aria-label="جزئیات ${b.title}">${coverView(b, ctx.summaryFor(b.id))}</button>
    <div class="card__body">
      ${item.fit ? html`<span class="fit fit--${item.fit}">${FIT_LABELS[item.fit]}</span>` : ''}
      <h3 class="card__title"><button type="button" data-act="open" data-id="${b.id}">${b.title}</button></h3>
      <p class="card__people">${people(b)}</p>
      <p class="card__meta">${bookMeta(b, ctx)}</p>
      ${reasonsLine(item)}
      ${shelfButtons(b, ctx, { compact: true })}
    </div>
  </article>`;
}

export function topPickView(item, ctx) {
  const b = item.book;
  const sum = ctx.summaryFor(b.id);
  return html`<article class="top" data-book="${b.id}">
    <button type="button" class="top__cover" data-act="open" data-id="${b.id}" aria-label="جزئیات ${b.title}">${coverView(b, sum, { size: 'lg', eager: true })}</button>
    <div class="top__body">
      ${item.fit ? html`<span class="fit fit--${item.fit}">${FIT_LABELS[item.fit]}</span>` : ''}
      <h3 class="top__title display">${b.title}</h3>
      <p class="card__people">${people(b)}</p>
      <p class="card__meta">${bookMeta(b, ctx)}</p>
      ${reasonsLine(item)}
      ${b.quote ? html`<blockquote class="quote">${b.quote}</blockquote>` : ''}
      <div class="top__summary" data-summary-for="${b.id}">${summaryPreview(ctx.summaryState(b.id))}</div>
      <div class="top__actions">
        <button type="button" class="btn btn--primary" data-act="open" data-id="${b.id}">بیشتر درباره‌ش ${icon('arrow', { size: 18 })}</button>
        ${shelfButtons(b, ctx)}
      </div>
    </div>
  </article>`;
}

export function summaryPreview(state) {
  if (!state || state.status === 'loading') return html`<div class="skeleton" aria-label="در حال آوردن خلاصه"><span></span><span></span><span></span></div>`;
  if (state.status !== 'ok') return '';
  const text = state.data.text;
  const short = text.length > 260 ? `${text.slice(0, 260).replace(/\s+\S*$/, '')}…` : text;
  return html`<p class="summary ${state.data.lang === 'en' ? 'summary--en' : ''}" ${state.data.lang === 'en' ? LTR : ''}>${short}</p>`;
}

export function resultsView(result, ctx, { pageSize, shown }) {
  const { items, total, hasQuery, relax } = result;
  if (!items.length) {
    return html`<div class="empty">
      <h2 class="display">با این ترکیب، کتابی تو قفسه نداریم</h2>
      <p>یکی از محدودیت‌ها رو بردار تا گزینه‌ها برگردن.</p>
      <div class="empty__actions">
        ${relax ? html`<button type="button" class="btn btn--primary" data-act="relax" data-key="${relax.key}">برداشتن ${relaxLabel(relax.key, ctx)} (${fa(relax.count)} کتاب برمی‌گرده)</button>` : ''}
        <button type="button" class="btn btn--ghost" data-act="reset">از اول</button>
      </div>
    </div>`;
  }
  const loose = hasQuery && items[0].fit === 'loose';
  const [first, ...rest] = items;
  const list = hasQuery ? rest : items;
  const visible = list.slice(0, shown);
  return html`
    <header class="results__head">
      <div>
        <h2 class="results__title display">${hasQuery ? 'پیشنهادهای امشب' : 'از قفسه‌ی فراگمان'}</h2>
        <p class="results__sub">${hasQuery ? `بین ${fa(ctx.total)} کتاب گشتم؛ ${fa(total)} تا با خواسته‌ت جور درمیاد.` : 'هنوز چیزی نگفتی؛ این‌ها نقطه‌ی شروع خوبی‌ان.'}</p>
      </div>
      <div class="results__tools">
        <button type="button" class="btn btn--ghost" data-act="shuffle">${icon('shuffle', { size: 18 })}<span>یه سری دیگه</span></button>
        ${hasQuery ? html`<button type="button" class="btn btn--ghost" data-act="share">${icon('link', { size: 18 })}<span>لینک این جست‌وجو</span></button>` : ''}
      </div>
    </header>
    ${loose ? html`<p class="notice">چیزی که دقیقاً با همه‌ی خواسته‌هات بخونه پیدا نکردم؛ این‌ها نزدیک‌ترین‌ها هستن.
      ${relax ? html`<button type="button" class="link-btn" data-act="relax" data-key="${relax.key}">برداشتن ${relaxLabel(relax.key, ctx)}</button>` : ''}</p>` : ''}
    ${hasQuery ? topPickView(first, ctx) : ''}
    ${visible.length ? html`<div class="grid">${visible.map((it) => cardView(it, ctx))}</div>` : ''}
    ${list.length > shown ? html`<div class="more"><button type="button" class="btn btn--ghost" data-act="more">${fa(Math.min(pageSize, list.length - shown))} کتاب دیگه</button></div>` : ''}
  `;
}

/* ---------- Book sheet ---------- */

export function sheetView(book, ctx, { item, similar, summary, expanded }) {
  const label = (g, id) => ctx.vocab[g].byId.get(id)?.label ?? id;
  const series = book.series ? `${book.series}${book.series_number ? ` · جلد ${fa(book.series_number)}` : ''}` : '';
  return html`
    <div class="sheet__grid">
      <div class="sheet__side">
        ${coverView(book, ctx.summaryFor(book.id), { size: 'lg', eager: true })}
        ${shelfButtons(book, ctx)}
      </div>
      <div class="sheet__main">
        <h2 id="sheet-title" class="sheet__title display">${book.title}</h2>
        ${book.title_en ? html`<p class="sheet__en" dir="ltr" lang="en">${book.title_en}${book.author_en ? ` — ${book.author_en}` : ''}</p>` : ''}
        <p class="card__people">${people(book)}</p>
        ${book.note ? html`<p class="sheet__note muted">${book.note}</p>` : ''}
        <dl class="facts">
          ${book.pages ? html`<div><dt>حجم</dt><dd>${fa(book.pages)} صفحه · ${readingTime(book.pages, ctx.pph)}<small>${readingPlan(book.pages, ctx.pph)}</small></dd></div>` : ''}
          ${book.year ? html`<div><dt>سال انتشار</dt><dd>${fa(book.year)}</dd></div>` : ''}
          ${series ? html`<div><dt>مجموعه</dt><dd>${series}</dd></div>` : ''}
          <div><dt>مخاطب</dt><dd>${label('audiences', book.audience)}${book.format !== 'novel' ? ` · ${label('formats', book.format)}` : ''}</dd></div>
        </dl>
        ${item?.reasons?.length ? html`<p class="why why--sheet"><span class="why__plus">چرا این: ${item.reasons.join(' · ')}</span>${item.caveats?.length ? html`<span class="why__minus">${item.caveats.join(' · ')}</span>` : ''}</p>` : ''}
        ${book.quote ? html`<blockquote class="quote">${book.quote}</blockquote>` : ''}
        <section class="sheet__summary" aria-label="خلاصه">${sheetSummary(summary, expanded)}</section>
        <div class="tagline">
          ${book.genres.map((g) => html`<button type="button" class="tag tag--link" data-act="pick" data-kind="genre" data-id="${g}">${label('genres', g)}</button>`)}
          ${book.moods.map((m) => html`<button type="button" class="tag tag--link" data-act="pick" data-kind="mood" data-id="${m}">${label('moods', m)}</button>`)}
          ${book.themes.map((t) => html`<button type="button" class="tag tag--link" data-act="pick" data-kind="theme" data-id="${t}">${label('themes', t)}</button>`)}
        </div>
        ${book.films.length ? html`<p class="sheet__line"><strong>اگه این‌ها رو دیدی و دوست داشتی:</strong> ${book.films.join('، ')}</p>` : ''}
        ${book.awards.length ? html`<p class="sheet__line"><strong>جایزه‌ها:</strong> ${book.awards.join('، ')}</p>` : ''}
        ${book.warnings.length ? html`<details class="warn"><summary>${icon('warning', { size: 16 })} هشدار محتوا (بدون لو رفتن داستان)</summary><p>${book.warnings.map((w) => label('warnings', w)).join('، ')}</p></details>` : ''}
        <div class="sheet__actions">
          <button type="button" class="btn btn--primary" data-act="like-this" data-id="${book.id}">شبیه این پیدا کن</button>
          <button type="button" class="btn btn--ghost" data-act="copy-book" data-id="${book.id}">${icon('link', { size: 18 })}<span>لینک این کتاب</span></button>
          ${book.link ? html`<a class="btn btn--ghost" href="${book.link}" target="_blank" rel="noopener">${icon('book', { size: 18 })}<span>تهیه‌ی کتاب</span></a>` : ''}
        </div>
      </div>
    </div>
    ${similar.length ? html`<section class="similar"><h3>اگه این به دلت نشست</h3><div class="similar__row">
      ${similar.map(({ book: s }) => html`<button type="button" class="mini" data-act="open" data-id="${s.id}">${coverView(s, ctx.summaryFor(s.id), { size: 'sm' })}<span>${s.title}</span></button>`)}
    </div></section>` : ''}
  `;
}

export function sheetSummary(state, expanded) {
  if (!state || state.status === 'loading') return html`<div class="skeleton" aria-label="در حال آوردن خلاصه"><span></span><span></span><span></span><span></span></div>`;
  if (state.status === 'none') return html`<p class="muted">خلاصه‌ای برای این کتاب پیدا نکردم.</p>`;
  const { lead, rest, data } = state;
  const en = data.lang === 'en';
  return html`
    <div class="summary" ${en ? LTR : ''}>
      <p>${lead}</p>
      ${rest && expanded ? html`<p>${rest}</p>` : ''}
    </div>
    <p class="summary__foot">
      ${rest ? html`<button type="button" class="link-btn" data-act="expand-summary">${expanded ? 'کوتاه‌تر' : 'ادامه‌ی خلاصه (ممکنه کمی از داستان رو لو بده)'}</button>` : ''}
      ${data.source ? html`<span class="muted">منبع: ${data.url ? html`<a href="${data.url}" target="_blank" rel="noopener">${data.source}</a>` : data.source}</span>` : ''}
    </p>`;
}

/* ---------- Shelf ---------- */

const SHELF_TABS = [['want', 'می‌خوام بخونم'], ['read', 'خوندم'], ['nope', 'کنار گذاشتم']];

export function shelfView(ctx, { tab, lists, pph }) {
  const ids = lists[tab] ?? [];
  const books = ids.map((id) => ctx.byId.get(id)).filter(Boolean);
  return html`
    <div class="tabs" role="tablist">
      ${SHELF_TABS.map(([id, label]) => html`<button type="button" role="tab" class="tabs__tab" data-act="shelf-tab" data-tab="${id}" aria-selected="${tab === id}">${label} <span class="chip__count">${fa((lists[id] ?? []).filter((x) => ctx.byId.has(x)).length)}</span></button>`)}
    </div>
    ${books.length ? html`<ul class="shelf-list">${books.map((b) => html`<li>
        <button type="button" class="shelf-list__book" data-act="open" data-id="${b.id}">${coverView(b, ctx.summaryFor(b.id), { size: 'sm' })}<span><strong>${b.title}</strong><small>${b.author}</small></span></button>
        <button type="button" class="btn btn--ghost btn--quiet" data-act="unshelf" data-id="${b.id}">${icon('close', { size: 16 })}<span>${tab === 'nope' ? 'برگردون به پیشنهادها' : 'حذف'}</span></button>
      </li>`)}</ul>`
      : html`<p class="muted shelf-empty">${tab === 'want' ? 'هنوز چیزی اینجا نیست. روی «می‌خوام بخونم» هر کتاب بزن تا این‌جا بمونه.' : tab === 'read' ? 'کتاب‌هایی که خوندی این‌جا می‌آد و دیگه پیشنهاد داده نمی‌شن.' : 'کتاب‌هایی که کنار بذاری این‌جا می‌آد و هر وقت خواستی برمی‌گردونیشون.'}</p>`}
    <div class="shelf-settings">
      <label>سرعت خوندنم
        <select data-act="pph">
          ${[[25, 'آهسته (۲۵ صفحه در ساعت)'], [40, 'معمولی (۴۰ صفحه در ساعت)'], [60, 'تند (۶۰ صفحه در ساعت)']].map(([v, l]) => html`<option value="${v}" ${pph === v ? 'selected' : ''}>${l}</option>`)}
        </select>
      </label>
      <div class="shelf-io">
        <button type="button" class="btn btn--ghost" data-act="export">${icon('download', { size: 18 })}<span>پشتیبان‌گیری</span></button>
        <label class="btn btn--ghost">${icon('upload', { size: 18 })}<span>بازگردانی</span><input type="file" accept="application/json" data-act="import" hidden></label>
      </div>
      <p class="muted">قفسه فقط روی همین مرورگر ذخیره می‌شه؛ هیچ‌جا فرستاده نمی‌شه.</p>
    </div>`;
}

/* ---------- Surprise ---------- */

export function surpriseView(book, ctx, { revealed }) {
  if (!book) return html`<p class="muted">همه‌ی کتاب‌های مناسب رو یا خوندی یا کنار گذاشتی. فیلترها رو سبک‌تر کن.</p>`;
  const label = (g, id) => ctx.vocab[g].byId.get(id)?.label ?? id;
  const size = !book.pages ? '' : book.pages < 300 ? 'کوتاه' : book.pages < 500 ? 'متوسط' : 'بلند';
  return html`
    <div class="blind ${revealed ? 'is-revealed' : ''}">
      <div class="blind__wrap">
        ${revealed ? html`<button type="button" class="blind__cover" data-act="open" data-id="${book.id}">${coverView(book, ctx.summaryFor(book.id), { size: 'md', eager: true })}</button>`
          : html`<div class="blind__paper" aria-hidden="true">${icon('book', { size: 40 })}</div>`}
      </div>
      <div class="blind__clues">
        ${book.quote ? html`<blockquote class="quote">${book.quote}</blockquote>` : ''}
        <ul class="clues">
          <li><span>حس‌وحال</span>${book.moods.slice(0, 3).map((m) => label('moods', m)).join('، ')}</li>
          <li><span>مایه‌ها</span>${book.themes.slice(0, 3).map((t) => label('themes', t)).join('، ')}</li>
          ${size ? html`<li><span>حجم</span>${size}</li>` : ''}
        </ul>
        ${revealed ? html`<h3 class="display blind__title">${book.title}</h3><p class="card__people">${people(book)}</p>` : ''}
        <div class="sheet__actions">
          ${revealed ? html`<button type="button" class="btn btn--primary" data-act="open" data-id="${book.id}">بیشتر درباره‌ش</button>`
            : html`<button type="button" class="btn btn--primary" data-act="reveal">نشونم بده چه کتابیه</button>`}
          <button type="button" class="btn btn--ghost" data-act="another">${icon('dice', { size: 18 })}<span>یکی دیگه</span></button>
        </div>
      </div>
    </div>`;
}

/* ---------- Feed ---------- */

export function feedView(items, ctx) {
  if (!items?.length) return '';
  return html`<div class="feed__inner">
    <h2 class="display">تازه‌های ${ctx.parentName}</h2>
    <ul class="feed__list">${items.slice(0, 4).map((it) => html`<li><a href="${it.url}" target="_blank" rel="noopener"><span>${it.title}</span>${it.date ? html`<small>${it.date}</small>` : ''}</a></li>`)}</ul>
  </div>`;
}
