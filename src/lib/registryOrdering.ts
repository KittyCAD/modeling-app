/**
 * How contributed lists are ordered and deduplicated.
 *
 * Every value spec whose entries are *placed* somewhere — shell items, overlays,
 * screens, scene items — answers the same two questions the same way: lower
 * `order` sorts earlier with the id as a stable tiebreaker, and the first
 * contribution of an id wins so an override can replace a built-in by reusing
 * its id.
 *
 * Shared rather than repeated per contract, because two lists that sort *almost*
 * the same way is a bug nobody finds by reading either one.
 */

export const byOrder = <T extends { order?: number; id: string }>(
  inputs: readonly T[]
): T[] =>
  [...inputs].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  )

export const dedupeById = <T extends { id: string }>(
  inputs: readonly T[]
): T[] => {
  const seen = new Set<string>()
  return inputs.filter((input) => {
    if (seen.has(input.id)) return false
    seen.add(input.id)
    return true
  })
}
