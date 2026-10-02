/**
 * Cover strategy: a generated typographic cover is always rendered as the base
 * layer; real images (editor URL → Wikipedia image from summaries.json → Open
 * Library by ISBN) are layered on top and simply removed if they fail.
 * Result: no broken images, no layout shift, works offline.
 */
import { html } from '../core/dom.js';

const PALETTES = {
  grimdark: ['#3a1d22', '#7b3a35'],
  cyberpunk: ['#122a3a', '#2b6f84'],
  'hard-sf': ['#14243d', '#3d6a8f'],
  'space-opera': ['#231b3f', '#5d4a8a'],
  'epic-fantasy': ['#2c2414', '#8a6a2e'],
  fantasy: ['#1d2c22', '#5a7a4c'],
  dystopia: ['#2a2622', '#7a5b3e'],
  'post-apocalyptic': ['#2c2620', '#866a48'],
  horror: ['#1f1416', '#5e2b2f'],
  weird: ['#1d2621', '#4f6b4a'],
  'magical-realism': ['#24203a', '#6f5f9a'],
  sf: ['#16243a', '#46648a'],
};

function palette(book) {
  for (const g of book.genres) if (PALETTES[g]) return PALETTES[g];
  return ['#1b2642', '#4a5a7a'];
}

export function coverSources(book, summary) {
  const list = [];
  if (book.cover) list.push(book.cover);
  if (summary?.cover) list.push(summary.cover);
  if (book.isbn) list.push(`https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg?default=false`);
  return [...new Set(list)];
}

/** Markup for a cover. `size` is 'sm' | 'md' | 'lg'. */
export function coverView(book, summary, { size = 'md', eager = false } = {}) {
  const [a, b] = palette(book);
  const sources = coverSources(book, summary);
  return html`<div class="cover cover--${size}" style="--c1:${a};--c2:${b}">
    <div class="cover__gen" aria-hidden="true">
      <span class="cover__title">${book.title.replace(/\s*\(.*\)\s*/, '')}</span>
      <span class="cover__author">${book.author}</span>
    </div>
    ${sources.length ? html`<img class="cover__img" alt="" decoding="async" loading="${eager ? 'eager' : 'lazy'}" referrerpolicy="no-referrer"
      src="${sources[0]}" data-fallbacks="${sources.slice(1).join(' ')}">` : ''}
  </div>`;
}

/** One global listener handles the fallback chain for every cover image. */
export function installCoverFallbacks(root = document) {
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover__img')) return;
    const rest = (img.dataset.fallbacks || '').split(' ').filter(Boolean);
    if (rest.length) { img.dataset.fallbacks = rest.slice(1).join(' '); img.src = rest[0]; }
    else img.remove();
  }, true);
  root.addEventListener('load', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover__img')) return;
    // Open Library returns a 1×1 gif for some misses; treat tiny images as failures.
    if (img.naturalWidth < 20) img.dispatchEvent(new Event('error'));
    else img.classList.add('is-loaded');
  }, true);
}
