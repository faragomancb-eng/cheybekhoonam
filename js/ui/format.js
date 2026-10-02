import { toPersianDigits } from '../core/text.js';

export const fa = (n) => toPersianDigits(n);

/** «حدود ۹ ساعت» from pages and pages-per-hour. */
export function readingTime(pages, pph) {
  if (!pages || !pph) return '';
  const hours = pages / pph;
  if (hours < 1) return 'کمتر از یک ساعت';
  return `حدود ${fa(Math.round(hours))} ساعت`;
}

/** «اگه شبی یک ساعت بخونی، حدود ۲ هفته» */
export function readingPlan(pages, pph) {
  if (!pages || !pph) return '';
  const nights = Math.max(1, Math.round(pages / pph));
  if (nights <= 1) return 'یه شب کافیه';
  if (nights < 7) return `اگه شبی یک ساعت بخونی، ${fa(nights)} شب`;
  const weeks = Math.round(nights / 7);
  return `اگه شبی یک ساعت بخونی، حدود ${fa(weeks)} هفته`;
}

export function listFa(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join('، ')} و ${a[a.length - 1]}`;
}
