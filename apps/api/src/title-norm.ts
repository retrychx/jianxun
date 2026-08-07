// Normalized title used to dedup same-article URL variants per source.
// Must stay in sync with the backfill SQL in migrations/0006_title_norm.sql.
export function normalizeTitle(title: string): string {
  return title.trim().replace(/[ ，。　]/g, '').toLowerCase()
}
