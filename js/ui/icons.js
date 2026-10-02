/** One authored icon set: 24px grid, 1.6 stroke, round caps. */
import { raw } from '../core/dom.js';

const paths = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  arrow: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>',
  bookmarkFilled: '<path d="M7 4h10v16l-5-3.5L7 20z" fill="currentColor"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  nope: '<circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  shuffle: '<path d="M4 7h3.5c4 0 5 10 9 10H20"/><path d="M4 17h3.5c1.6 0 2.7-1.6 3.6-3.5"/><path d="M13 10.3C13.9 8.5 15 7 16.5 7H20"/><path d="m17.5 4.5 2.5 2.5-2.5 2.5"/><path d="m17.5 14.5 2.5 2.5-2.5 2.5"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="9" cy="9" r=".6" fill="currentColor"/><circle cx="15" cy="15" r=".6" fill="currentColor"/><circle cx="15" cy="9" r=".6" fill="currentColor"/><circle cx="9" cy="15" r=".6" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  feather: '<path d="M20 4c-6 0-11 4.5-11 11v5"/><path d="M9 15c4 0 8-2.5 9.5-7"/><path d="M5 20h8"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  warning: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M5 4h14"/>',
};

export function icon(name, { size = 20, label = '' } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return raw(`<svg class="i i-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${paths[name] ?? ''}</svg>`);
}
