import { describe, it, expect } from 'vitest'

import { shouldFlipCcwWithPrevious } from '@src/machines/sketchSolve/tools/centerArcToolImpl'

// const τ = 2 * Math.PI

const deg = (d: number) => (d * Math.PI) / 180

const pt = (angleRad: number, r = 1): [number, number] => [
  Math.cos(angleRad) * r,
  Math.sin(angleRad) * r,
]

describe('shouldFlipCcwWithPrevious', () => {
  const center: [number, number] = [0, 0]
  const start = pt(deg(0)) // (1,0)

  it('does not flip when staying CW on same side (<180°)', () => {
    const prevEnd = pt(deg(30))
    const newEnd = pt(deg(10))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(false)
  })

  it('does NOT flip when crossing seam in the same direction as the current CCW direction (1°→359°)', () => {
    const prevEnd = pt(deg(1))
    const newEnd = pt(deg(359))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(false)
  })
  it('does flip when crossing seam in the same direction as the current CCW direction (1°→359°)', () => {
    const prevEnd = pt(deg(1))
    const newEnd = pt(deg(359))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(true)
  })

  it('does not flip when staying CCW on same side', () => {
    const prevEnd = pt(deg(150))
    const newEnd = pt(deg(170))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(false)
  })

  it('does NOT flip when crossing seam in the same direction as the current CCW direction (359°→1°)', () => {
    const prevEnd = pt(deg(359))
    const newEnd = pt(deg(1))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(false)
  })
  it('does flip when crossing seam in the same direction as the current CCW direction (359°→1°)', () => {
    const prevEnd = pt(deg(359))
    const newEnd = pt(deg(1))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(true)
  })

  it('does not flip when crossing 180° CW', () => {
    const prevEnd = pt(deg(170))
    const newEnd = pt(deg(190))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: false,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(false)
  })

  it('does not flip when crossing 180° CCW', () => {
    const prevEnd = pt(deg(190))
    const newEnd = pt(deg(170))
    const flipped = shouldFlipCcwWithPrevious({
      currentCcw: true,
      center,
      start,
      end: newEnd,
      previousEnd: prevEnd,
    })
    expect(flipped).toBe(false)
  })
})
