// Shared helpers for the Node tools.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildVocab, buildCatalog, parseBooksFile } from '../js/core/catalog.js';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Reads CONFIG.booksUrl from js/config.js so tools and site always use the same file. */
export async function booksPath() {
  const { CONFIG } = await import(path.join(root, 'js/config.js'));
  return path.join(root, CONFIG.booksUrl.replace(/^\.\//, ''));
}

export async function loadCatalog() {
  const file = await booksPath();
  const vocab = buildVocab(JSON.parse(await fs.readFile(path.join(root, 'data/vocab.json'), 'utf8')));
  const rows = parseBooksFile(file, await fs.readFile(file, 'utf8'));
  return { file, vocab, ...buildCatalog(rows, vocab) };
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
