/**
 * «کتاب امشب»: one pick per night, the same for every visitor, without a server.
 *
 * - The night is computed in Tehran time and changes at 05:00, so someone
 *   reading after midnight still sees «tonight's» book.
 * - The pool (translated books, so readers can actually get them) is put in a
 *   seeded random order; consecutive nights walk through that order, so no
 *   book repeats until the whole pool has been shown.
 * - Pure functions only: easy to test and to reuse for the Telegram post.
 */

const DAY = 864e5;
const ROLLOVER_HOURS = 5;

/** Days since 1970-01-01 for the current «night» in the given time zone. */
export function nightIndex(now = new Date(), timeZone = 'Asia/Tehran') {
  const shifted = new Date(now.getTime() - ROLLOVER_HOURS * 36e5);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(shifted);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / DAY);
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Books that can be «tonight's book»: translated and complete enough to present. */
export function tonightPool(books) {
  return books
    .filter((b) => b.translated && b.translators.length && b.pages && b.moods.length)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The book for a given night (defaults to now). Returns null if the pool is empty. */
export function tonightPick(books, { now = new Date(), timeZone = 'Asia/Tehran' } = {}) {
  const pool = tonightPool(books);
  if (!pool.length) return null;
  const day = nightIndex(now, timeZone);
  const cycle = Math.floor(day / pool.length);
  const pos = day % pool.length;
  // Order the pool by a per-cycle hash: a stable permutation without storing anything.
  const order = pool.map((b) => [fnv(`${cycle}:${b.id}`), b]).sort((x, y) => x[0] - y[0]);
  return order[pos][1];
}

/** «۲۱ مهر» for the current night in the Persian calendar. */
export function nightLabel(now = new Date(), timeZone = 'Asia/Tehran') {
  const shifted = new Date(now.getTime() - ROLLOVER_HOURS * 36e5);
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone, day: 'numeric', month: 'long' }).format(shifted);
  } catch {
    return '';
  }
}
