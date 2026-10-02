/**
 * Summaries are split into small files so a visitor only downloads the few
 * they actually open. Changing SHARDS means re-running `npm run prefetch`.
 */
export const SHARDS = 64;

/** Stable shard number for a book id (FNV-1a). */
export function shardOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % SHARDS;
}

export const shardName = (n) => `${String(n).padStart(2, '0')}.json`;
