const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * A compact relative timestamp for title blocks and status fields.
 *
 * Deliberately terse — `3w`, not "3 weeks ago" — because these sit in
 * hairline-ruled fields where the label already supplies the noun and the
 * column has to hold its width.
 */
export function formatRelativeTime(
  timestamp: number,
  now = Date.now()
): string {
  const elapsed = Math.max(0, now - timestamp)

  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`
  if (elapsed < 52 * WEEK) return `${Math.floor(elapsed / WEEK)}w`
  return `${Math.floor(elapsed / (52 * WEEK))}y`
}

/** Zero-padded revision, so the field does not change width as it climbs. */
export function formatRevision(revision: number | undefined): string {
  if (revision === undefined) return '—'
  return String(revision).padStart(2, '0')
}

/** Case-insensitive substring match, for filtering lists as you type. */
export function matchesQuery(haystack: string, query: string): boolean {
  if (!query) return true
  return haystack.toLowerCase().includes(query.trim().toLowerCase())
}
