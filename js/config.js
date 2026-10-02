/**
 * Site settings. This is the only file most maintainers need to touch.
 */
export const CONFIG = {
  siteName: 'چی بخونم؟',
  parentName: 'فراگمان',
  parentUrl: 'https://faragomancb.ir',

  /** Book list. Either a JSON array (books.json) or a CSV exported from Excel / Google Sheets. */
  booksUrl: './data/books.json',
  vocabUrl: './data/vocab.json',
  /** Built by tools/prefetch.mjs. Missing files are fine. */
  coversUrl: './data/covers.json',
  summariesDir: './data/summaries/',
  feedUrl: './data/feed.json',

  /** Live summary lookup in the visitor's browser when a book has no prebuilt summary. */
  liveSummaries: true,
  /** Optional Google Books API key (raises the anonymous quota). Leave empty if unsure. */
  googleBooksApiKey: '',
  /** Days a live-fetched summary stays cached in the visitor's browser. */
  summaryCacheDays: 30,

  /** Average pages per hour, used for «about N hours» estimates. Visitors can change it. */
  defaultPagesPerHour: 40,

  /** How many results to show before «show more». */
  pageSize: 9,
};
