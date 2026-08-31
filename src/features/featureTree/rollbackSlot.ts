/**
 * Which gap in the feature list a pointer is over.
 *
 * The rollback bar sits *between* operations, so what a drag is choosing is a
 * gap and not a row: slot `n` means "before the nth operation", and
 * `rows.length` means "after all of them".
 *
 * Pure, and given plain geometry rather than elements, because the rule is the
 * interesting part and it is worth being able to state it without a DOM: a row's
 * midpoint is the boundary, so the bar lands above a row while the pointer is in
 * its top half and below it after that. Anything else — using the row's top
 * edge, say — makes the last few pixels of a row mean the same as the first few
 * of the next, which reads as the bar refusing to go where it is being put.
 */

export interface SlotRow {
  /** Where this row's gap sits in the list. */
  index: number
  top: number
  height: number
}

export function slotAtY(rows: readonly SlotRow[], y: number): number {
  for (const row of rows) {
    if (y < row.top + row.height / 2) return row.index
  }

  // Past every midpoint, which is the gap after the last operation.
  return rows.length
}
