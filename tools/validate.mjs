// Checks the book list against data/vocab.json. Exit code 1 on errors (CI blocks the deploy).
// Usage: npm run validate
import path from 'node:path';
import { loadCatalog, root } from './lib.mjs';

let result;
try {
  result = await loadCatalog();
} catch (err) {
  console.error(`✗ فایل کتاب‌ها خوانده نشد: ${err.message}`);
  console.error('  اگر JSON است، احتمالاً یک ویرگول یا گیومه جا افتاده. https://jsonlint.com کمک می‌کند.');
  process.exit(1);
}
const { file, books, issues } = result;
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');
const where = (i) => `ردیف ${i.row}${i.id ? ` (${i.id})` : ''}${i.field ? ` · ${i.field}` : ''}`;

console.log(`فایل: ${path.relative(root, file)}`);
for (const i of errors) console.log(`  ✗ ${where(i)}: ${i.message}`);
for (const i of warnings) console.log(`  ! ${where(i)}: ${i.message}`);
console.log(`${books.length} کتاب سالم · ${errors.length} خطا · ${warnings.length} هشدار`);
process.exit(errors.length ? 1 : 0);
