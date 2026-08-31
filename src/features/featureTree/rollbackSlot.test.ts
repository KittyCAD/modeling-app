import { describe, expect, it } from 'vitest'
import { slotAtY } from '@src/features/featureTree/rollbackSlot'

/** Three rows, 20px each, starting at 100. */
const rows = [
  { index: 0, top: 100, height: 20 },
  { index: 1, top: 120, height: 20 },
  { index: 2, top: 140, height: 20 },
]

describe('slotAtY', () => {
  it('puts the bar above a row while the pointer is in its top half', () => {
    expect(slotAtY(rows, 105)).toBe(0)
    expect(slotAtY(rows, 125)).toBe(1)
  })

  it('puts it below once the pointer passes the midpoint', () => {
    // The midpoint is the boundary. Using the top edge instead would make the
    // last pixels of a row mean the same as the first of the next, which reads
    // as the bar refusing to go where it is put.
    expect(slotAtY(rows, 115)).toBe(1)
    expect(slotAtY(rows, 135)).toBe(2)
  })

  it('lands after everything when the pointer is below the list', () => {
    expect(slotAtY(rows, 900)).toBe(3)
  })

  it('lands before everything when the pointer is above it', () => {
    expect(slotAtY(rows, 0)).toBe(0)
  })

  it('has one slot in an empty list', () => {
    expect(slotAtY([], 500)).toBe(0)
  })

  /* Rows are measured, so a collapsed one is a real possibility. */
  it('copes with a row of no height', () => {
    expect(slotAtY([{ index: 0, top: 100, height: 0 }], 100)).toBe(1)
  })
})
