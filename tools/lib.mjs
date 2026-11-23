// Shared helpers for the Node tools.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildVocab, buildCatalog, parseBooksFile } from '../js/core/catalog.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadConfig() {
  const { CONFIG } = await import(pathToFileURL(path.join(root, 'js/config.js')).href);
  return CONFIG;
}

/** Reads CONFIG.booksUrl from js/config.js so tools and site always use the same file. */
export async function booksPath() {
  const CONFIG = await loadConfig();
  return path.join(root, CONFIG.booksUrl.replace(/^\.\//, ''));
}

export async function loadCatalog() {
  const file = await booksPath();
  const vocab = buildVocab(JSON.parse(await fs.readFile(path.join(root, 'data/vocab.json'), 'utf8')));
  const rows = parseBooksFile(file, await fs.readFile(file, 'utf8'));
  return { file, vocab, ...buildCatalog(rows, vocab) };
}

export async function loadNovelsCatalog() {
  const CONFIG = await loadConfig();
  const file = path.join(root, CONFIG.novelsUrl.replace(/^\.\//, ''));
  const vocabFile = path.join(root, CONFIG.novelsVocabUrl.replace(/^\.\//, ''));
  const vocab = buildVocab(JSON.parse(await fs.readFile(vocabFile, 'utf8')));
  const rows = parseBooksFile(file, await fs.readFile(file, 'utf8'));
  return { file, vocab, ...buildCatalog(rows, vocab) };
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
