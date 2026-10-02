/** Human-readable Persian labels for signals. */
import { fa } from './format.js';

const DIM_LABELS = {
  length: { short: 'کوتاه', medium: 'حجم متوسط', long: 'بلند و مفصل', 'not-short': 'نه خیلی کوتاه', 'not-long': 'نه خیلی بلند' },
  pace: { fast: 'ریتم تند', slow: 'ریتم آرام', steady: 'ریتم متعادل', 'not-fast': 'نه خیلی تند', 'not-slow': 'نه خیلی کند' },
  darkness: { light: 'روشن و ملایم', 'not-dark': 'نه خیلی تاریک', dark: 'تاریک و تلخ', 'not-light': 'نه خیلی روشن' },
  complexity: { easy: 'خوش‌خوان', deep: 'عمیق و چالشی', 'not-easy': 'نه خیلی ساده', 'not-deep': 'نه خیلی سنگین' },
  audience: { ya: 'مناسب نوجوان', adult: 'بزرگسال' },
  translated: { yes: 'فقط ترجمه‌شده' },
};

export const signalKey = (s) => `${s.kind}:${s.id}`;

export function signalLabel(s, { vocab, byId }) {
  const group = { mood: 'moods', genre: 'genres', theme: 'themes', warning: 'warnings', format: 'formats' }[s.kind];
  if (group) {
    const label = vocab[group].byId.get(s.id)?.label ?? s.id;
    if (s.kind === 'warning') return `بدون ${label}`;
    return label;
  }
  if (DIM_LABELS[s.kind]) return DIM_LABELS[s.kind][s.id] ?? s.id;
  if (s.kind === 'pages') {
    const [k, n] = String(s.id).split(':');
    if (s.note) return `فقط ${fa(s.note)} وقت`;
    return k === 'max' ? `حداکثر ${fa(n)} صفحه` : k === 'min' ? `حداقل ${fa(n)} صفحه` : `حدود ${fa(n)} صفحه`;
  }
  if (s.kind === 'seed') return `شبیه «${byId.get(s.id)?.title ?? s.id}»`;
  if (s.kind === 'film') return `حال‌وهوای «${String(s.label ?? s.id).replace(/\s*\(.*\)\s*/, '')}»`;
  if (s.kind === 'author') return `از ${s.id}`;
  return s.id;
}

export const FIT_LABELS = {
  strong: 'خیلی به حال‌وهوات می‌خوره',
  good: 'نزدیک به چیزیه که گفتی',
  loose: 'شاید',
};

export function relaxLabel(key, ctx) {
  const [kind, id] = key.split(':');
  const map = {
    translated: '«فقط ترجمه‌شده»', audience: 'محدودیت سنی', pages: 'محدودیت تعداد صفحه',
  };
  if (map[kind]) return map[kind];
  const group = { warning: 'warnings', genre: 'genres', theme: 'themes', mood: 'moods' }[kind];
  return group ? `«${ctx.vocab[group].byId.get(id)?.label ?? id}»` : key;
}
