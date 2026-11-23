// Checks books.json and novels.json against their vocabularies. Exit code 1 on errors (CI blocks the deploy).
// Usage: npm run validate
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCatalog, loadNovelsCatalog, root } from './lib.mjs';

const where = (i) => `ردیف ${i.row}${i.id ? ` (${i.id})` : ''}${i.field ? ` · ${i.field}` : ''}`;

function report(label, { file, books, issues }) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  console.log(`فایل: ${path.relative(root, file)}`);
  for (const i of errors) console.log(`  ✗ ${where(i)}: ${i.message}`);
  for (const i of warnings) console.log(`  ! ${where(i)}: ${i.message}`);
  console.log(`${books.length} ${label} سالم · ${errors.length} خطا · ${warnings.length} هشدار`);
  return errors.length;
}

let totalErrors = 0;
let booksRes;
try {
  booksRes = await loadCatalog();
} catch (err) {
  console.error(`✗ فایل کتاب‌ها خوانده نشد: ${err.message}`);
  console.error('  اگر JSON است، احتمالاً یک ویرگول یا گیومه جا افتاده. https://jsonlint.com کمک می‌کند.');
  process.exit(1);
}
totalErrors += report('کتاب', booksRes);

const novelsFile = path.join(root, 'data/novels.json');
let hasNovels = false;
try { await fs.access(novelsFile); hasNovels = true; } catch { /* optional */ }
if (hasNovels) {
  let novelsRes;
  try {
    novelsRes = await loadNovelsCatalog();
  } catch (err) {
    console.error(`✗ فایل ناول‌های شرقی خوانده نشد: ${err.message}`);
    process.exit(1);
  }
  totalErrors += report('ناول شرقی', novelsRes);
  const bookIds = new Set(booksRes.books.map((b) => b.id));
  const dupes = novelsRes.books.filter((n) => bookIds.has(n.id));
  for (const d of dupes) {
    console.log(`  ✗ تداخل شناسه بین books.json و novels.json: ${d.id}`);
    totalErrors++;
  }
}

process.exit(totalErrors ? 1 : 0);
