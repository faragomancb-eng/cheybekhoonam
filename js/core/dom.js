/**
 * Tiny rendering helpers. Every interpolated value is escaped unless it is
 * explicitly wrapped with raw(), so book data can never inject markup.
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const RAW = Symbol('raw');

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const raw = (s) => ({ [RAW]: true, value: String(s) });

/** Tagged template: html`<p>${userText}</p>` */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return raw(out);
}

function render(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && v[RAW]) return v.value;
  return escapeHtml(v);
}

/** Replaces an element's content with an html`` result. */
export function mount(el, view) {
  if (el) el.innerHTML = render(view);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated event listener: on(root, 'click', '[data-act]', (e, el) => ...) */
export function on(root, type, selector, handler, options) {
  root.addEventListener(type, (event) => {
    const el = event.target.closest(selector);
    if (el && root.contains(el)) handler(event, el);
  }, options);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
