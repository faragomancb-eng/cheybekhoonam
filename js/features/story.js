/**
 * Story card: a 1080×1920 image of a book for Instagram/Telegram stories.
 *
 * Loaded on demand (dynamic import) so it costs nothing until someone uses it.
 * Everything is drawn on a canvas in the browser. Remote covers are used only
 * if their host allows CORS; otherwise a typographic cover is drawn, so the
 * card never fails and the canvas is never «tainted».
 *
 * Sharing needs a fresh user gesture, so the card is first shown in a preview
 * dialog and the share/download buttons work on the already-built file.
 */

const W = 1080;
const H = 1920;
const C = {
  ink: '#0a1020', parchment: '#f1e7d2', parchment2: '#d8ccb2', muted: '#a99d85',
  saffron: '#eaa846', moon: '#f6dfae', line: 'rgba(216,204,178,0.28)',
};
const FONT = "'Vazirmatn', Tahoma, sans-serif";
const DISPLAY = "'Aref Ruqaa', 'Vazirmatn', serif";

const loadImage = (src, { cors = false, timeout = 6000 } = {}) => new Promise((resolve) => {
  const img = new Image();
  if (cors) img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  const t = setTimeout(() => resolve(null), timeout);
  img.onload = () => { clearTimeout(t); resolve(img.naturalWidth >= 20 ? img : null); };
  img.onerror = () => { clearTimeout(t); resolve(null); };
  img.src = src;
});

/** True if the image can be drawn without tainting the canvas. */
function isClean(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 1, 1);
    x.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

async function firstCover(sources) {
  for (const src of sources) {
    const img = await loadImage(src, { cors: true });
    if (img && isClean(img)) return img;
  }
  return null;
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.split(' ').slice(0, -1).join(' ');
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCoverFit(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * s;
  const ih = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function drawGeneratedCover(ctx, card, x, y, w, h) {
  const [a, b] = card.palette;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(246,223,174,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 28, y + 28, w - 56, h - 56);
  ctx.fillStyle = C.moon;
  ctx.textAlign = 'center';
  ctx.font = `700 64px ${DISPLAY}`;
  const lines = wrap(ctx, card.title, w - 110, 4);
  const top = y + h / 2 - (lines.length * 92) / 2 + 40;
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, top + i * 92));
  ctx.font = `400 32px ${FONT}`;
  ctx.fillStyle = C.parchment2;
  ctx.fillText(card.author, x + w / 2, y + h - 80);
}

async function render(card) {
  await Promise.all([
    document.fonts.load(`700 76px ${DISPLAY}`), document.fonts.load(`400 36px ${FONT}`), document.fonts.load(`700 36px ${FONT}`),
  ]).catch(() => {});
  const [bg, cover] = await Promise.all([loadImage(card.backdrop), firstCover(card.coverSources)]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';

  // Backdrop + veil
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, H);
  if (bg) { ctx.globalAlpha = 0.85; drawCoverFit(ctx, bg, 0, 0, W, H); ctx.globalAlpha = 1; }
  const veil = ctx.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, 'rgba(10,16,32,0.55)');
  veil.addColorStop(0.35, 'rgba(10,16,32,0.72)');
  veil.addColorStop(1, 'rgba(10,16,32,0.96)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);

  // Brand
  ctx.textAlign = 'center';
  ctx.fillStyle = C.moon;
  ctx.font = `700 70px ${DISPLAY}`;
  ctx.fillText('چی بخونم؟', W / 2, 150);
  ctx.fillStyle = C.muted;
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText('از قفسه‌ی فراگمان', W / 2, 200);

  // Kicker (and the reader's own words, if any)
  let y = 290;
  ctx.fillStyle = C.saffron;
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText(card.kicker, W / 2, y);
  if (card.quote) {
    ctx.fillStyle = C.parchment;
    ctx.font = `400 36px ${FONT}`;
    const ql = wrap(ctx, `«${card.quote}»`, W - 200, 2);
    ql.forEach((l, i) => ctx.fillText(l, W / 2, y + 62 + i * 54));
    y += 62 + (ql.length - 1) * 54;
  }

  // Cover
  const cw = 500;
  const ch = 750;
  const cx = (W - cw) / 2;
  const cy = y + 60;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, cx, cy, cw, ch, 20);
  ctx.fillStyle = C.ink;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 20);
  ctx.clip();
  if (cover) drawCoverFit(ctx, cover, cx, cy, cw, ch);
  else drawGeneratedCover(ctx, card, cx, cy, cw, ch);
  ctx.restore();
  ctx.direction = 'rtl';

  // Title, people
  y = cy + ch + 110;
  ctx.textAlign = 'center';
  ctx.fillStyle = C.parchment;
  ctx.font = `700 78px ${DISPLAY}`;
  const tl = wrap(ctx, card.title, W - 140, 2);
  tl.forEach((l, i) => ctx.fillText(l, W / 2, y + i * 100));
  y += (tl.length - 1) * 100 + 70;
  ctx.font = `500 38px ${FONT}`;
  ctx.fillStyle = C.parchment2;
  ctx.fillText(card.author, W / 2, y);
  if (card.translators) {
    y += 52;
    ctx.font = `400 32px ${FONT}`;
    ctx.fillStyle = C.muted;
    wrap(ctx, `ترجمه‌ی ${card.translators}`, W - 160, 1).forEach((l) => ctx.fillText(l, W / 2, y));
  }

  // Mood chips (laid out right to left, centred)
  if (card.chips.length) {
    y += 90;
    ctx.font = `500 32px ${FONT}`;
    const pad = 30;
    const gap = 18;
    const widths = card.chips.map((t) => ctx.measureText(t).width + pad * 2);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
    let x = W / 2 + total / 2;
    card.chips.forEach((t, i) => {
      const w = widths[i];
      roundRect(ctx, x - w, y - 44, w, 64, 32);
      ctx.fillStyle = 'rgba(234,168,70,0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(234,168,70,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = C.moon;
      ctx.fillText(t, x - w / 2, y);
      x -= w + gap;
    });
  }
  if (card.meta) {
    y += 80;
    ctx.font = `400 30px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(card.meta, W / 2, y);
  }

  // Footer CTA
  ctx.fillStyle = C.parchment2;
  ctx.font = `400 34px ${FONT}`;
  ctx.fillText('تو هم بنویس امشب دلت چه داستانی می‌خواد', W / 2, H - 170);
  ctx.font = `700 38px ${FONT}`;
  ctx.direction = 'ltr';
  const url = card.url;
  const uw = ctx.measureText(url).width + 72;
  roundRect(ctx, (W - uw) / 2, H - 135, uw, 70, 35);
  ctx.fillStyle = C.saffron;
  ctx.fill();
  ctx.fillStyle = '#2a1a04';
  ctx.fillText(url, W / 2, H - 87);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

let dialog;
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'sheet sheet--narrow story';
  dialog.setAttribute('aria-labelledby', 'story-title');
  dialog.innerHTML = `<div class="sheet__scroll">
      <button type="button" class="dialog-close" data-act="close" aria-label="بستن">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <h2 id="story-title" class="display sheet__heading">کارت استوری</h2>
      <div class="story__frame"><div class="skeleton story__wait" aria-label="در حال ساختن کارت"><span></span><span></span><span></span></div></div>
      <div class="story__actions">
        <button type="button" class="btn btn--primary" data-story="share" hidden>اشتراک‌گذاری</button>
        <button type="button" class="btn btn--ghost" data-story="download" disabled>ذخیره‌ی تصویر</button>
      </div>
      <p class="muted story__hint">اندازه‌ی تصویر مخصوص استوری اینستاگرام و تلگرامه (۱۰۸۰×۱۹۲۰).</p>
    </div>`;
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (dialog.dataset.url) URL.revokeObjectURL(dialog.dataset.url); delete dialog.dataset.url; });
  document.body.append(dialog);
  return dialog;
}

/**
 * Opens the preview and builds the card.
 * @param {object} card {id,title,author,translators,kicker,quote,chips[],meta,coverSources[],palette[2],backdrop,url,shareText}
 */
export async function openStoryCard(card, { toast = () => {} } = {}) {
  const dlg = ensureDialog();
  const frame = dlg.querySelector('.story__frame');
  const shareBtn = dlg.querySelector('[data-story="share"]');
  const saveBtn = dlg.querySelector('[data-story="download"]');
  frame.innerHTML = '<div class="skeleton story__wait" aria-label="در حال ساختن کارت"><span></span><span></span><span></span></div>';
  shareBtn.hidden = true;
  saveBtn.disabled = true;
  if (!dlg.open) dlg.showModal();

  const token = Symbol('card');
  dlg.token = token;
  let blob;
  try {
    blob = await render(card);
  } catch (err) {
    console.error(err);
  }
  if (dlg.token !== token) return; // another card was requested meanwhile
  if (!blob) { frame.innerHTML = '<p class="muted">ساختن کارت نشد؛ دوباره امتحان کن.</p>'; return; }

  const url = URL.createObjectURL(blob);
  if (dlg.dataset.url) URL.revokeObjectURL(dlg.dataset.url);
  dlg.dataset.url = url;
  const img = new Image();
  img.className = 'story__img';
  img.alt = `کارت استوری «${card.title}»`;
  img.src = url;
  frame.replaceChildren(img);

  const name = `chi-bekhoonam-${card.id}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  shareBtn.hidden = !canShare;
  saveBtn.disabled = false;
  shareBtn.onclick = async () => {
    try {
      await navigator.share({ files: [file], title: card.title, text: card.shareText });
    } catch (err) {
      if (err?.name !== 'AbortError') toast('اشتراک‌گذاری نشد؛ تصویر رو ذخیره کن.');
    }
  };
  saveBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    toast('تصویر ذخیره شد.');
  };
}
