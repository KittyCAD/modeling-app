import { describe, expect, it } from 'vitest'
import { menuPanelShift } from './menu'

const shift = (
  left: number,
  right: number,
  viewportWidth = 1000,
  margin?: number
) => menuPanelShift({ left, right, viewportWidth, margin })

describe('keeping a menu panel on screen', () => {
  it('leaves a panel that already fits alone', () => {
    expect(shift(300, 620)).toBe(0)
  })

  /*
   * The reported bug: a status bar field opening `align="end"` sits wherever the
   * other fields leave it, and a 320px panel opening leftwards from a trigger
   * 200px in runs off the window.
   */
  it('pushes a panel back on screen when it overflows the start edge', () => {
    // Panel spans -120 → 200. It needs 128px to clear the 8px margin.
    expect(shift(-120, 200)).toBe(128)
  })

  it('pulls a panel back when it overflows the end edge', () => {
    // Panel spans 800 → 1120 in a 1000px window: 128px past the margin.
    expect(shift(800, 1120)).toBe(-128)
  })

  it('treats a panel exactly on the margin as fitting', () => {
    expect(shift(8, 328)).toBe(0)
    expect(shift(672, 992)).toBe(0)
  })

  it('respects a custom margin', () => {
    expect(shift(10, 330, 1000, 24)).toBe(14)
  })

  /*
   * Both edges overflow at once only when the panel is wider than the window.
   * The start edge wins: a panel readable from its beginning beats one whose
   * beginning is off screen.
   */
  it('pins the start edge when the panel is wider than the window', () => {
    const result = shift(-50, 1050, 1000)

    expect(result).toBe(58)
    expect(result).toBeGreaterThan(0)
  })

  it('rounds to whole pixels', () => {
    expect(shift(-0.4, 319.6)).toBe(8)
    expect(Number.isInteger(shift(800.6, 1120.6))).toBe(true)
  })
})
