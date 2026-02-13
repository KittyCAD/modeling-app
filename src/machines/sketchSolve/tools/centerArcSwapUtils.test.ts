import { describe, it, expect } from 'vitest'

import { shouldSwapStartEnd } from '@src/machines/sketchSolve/tools/centerArcSwapUtils'

const deg = (d: number) => (d * Math.PI) / 180

const pt = (angleRad: number, r = 1): [number, number] => [
  Math.cos(angleRad) * r,
  Math.sin(angleRad) * r,
]

describe('shouldSwapStartEnd', () => {
  const center: [number, number] = [0, 0]
  const start = pt(deg(0)) // (1,0)

  it('does not swap when staying on same side with no seam crossing (<180°)', () => {
    const prevEnd = pt(deg(30))
    const newEnd = pt(deg(10))
    const swapped = shouldSwapStartEnd({
      isSwapped: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(false)
  })

  it('does swap endpoints when crossing seam CW and not currently swapped (1°→359°)', () => {
    const prevEnd = pt(deg(1))
    const newEnd = pt(deg(359))
    const swapped = shouldSwapStartEnd({
      isSwapped: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(true)
  })

  it('does NOT swap endpoints when crossing seam CW and currently swapped (1°→359°)', () => {
    const prevEnd = pt(deg(1))
    const newEnd = pt(deg(359))
    const swapped = shouldSwapStartEnd({
      isSwapped: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(false)
  })

  it('does not swap when staying on same side with no seam crossing', () => {
    const prevEnd = pt(deg(150))
    const newEnd = pt(deg(170))
    const swapped = shouldSwapStartEnd({
      isSwapped: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(false)
  })

  it('does swap endpoints when crossing seam CCW and currently swapped (359°→1°)', () => {
    const prevEnd = pt(deg(359))
    const newEnd = pt(deg(1))
    const swapped = shouldSwapStartEnd({
      isSwapped: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(true)
  })

  it('does NOT swap endpoints when crossing seam CCW and not currently swapped (359°→1°)', () => {
    const prevEnd = pt(deg(359))
    const newEnd = pt(deg(1))
    const swapped = shouldSwapStartEnd({
      isSwapped: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(false)
  })

  it('does not swap when crossing 180° (only 0/360° seam crossing triggers swap)', () => {
    const prevEnd = pt(deg(170))
    const newEnd = pt(deg(190))
    const swapped = shouldSwapStartEnd({
      isSwapped: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(false)
  })

  it('does not swap when crossing 180° in reverse direction (only 0/360° seam crossing triggers swap)', () => {
    const prevEnd = pt(deg(190))
    const newEnd = pt(deg(170))
    const swapped = shouldSwapStartEnd({
      isSwapped: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(swapped).toBe(false)
  })
})
