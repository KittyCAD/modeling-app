import { describe, expect, it } from 'vitest'
import {
  midpoint,
  threePointArcCenter,
  threePointArcDirection,
} from '@src/lib/sketch/arcGeometry'

describe('the circle through three points', () => {
  it('finds the centre of a unit circle from three of its points', () => {
    const center = threePointArcCenter(
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 }
    )

    expect(center?.x).toBeCloseTo(0)
    expect(center?.y).toBeCloseTo(0)
  })

  it('does not care which order the points come in', () => {
    const a = threePointArcCenter(
      { x: 4, y: 1 },
      { x: 0, y: 5 },
      { x: 8, y: 5 }
    )
    const b = threePointArcCenter(
      { x: 8, y: 5 },
      { x: 4, y: 1 },
      { x: 0, y: 5 }
    )

    expect(a?.x).toBeCloseTo(b?.x ?? Number.NaN)
    expect(a?.y).toBeCloseTo(b?.y ?? Number.NaN)
  })

  /*
   * There is no circle through three points in a line. kcl-lib's own helper
   * answers with the centroid there, which the existing app rejects by radius —
   * a live preview has a better option: decline, and leave the last arc that made
   * sense on screen.
   */
  it('has no answer for three points in a line', () => {
    expect(
      threePointArcCenter({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })
    ).toBeNull()
  })

  it('has no answer for a point on top of another', () => {
    expect(
      threePointArcCenter({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    ).toBeNull()
  })
})

describe('which way the arc sweeps', () => {
  const center = { x: 0, y: 0 }
  const start = { x: 1, y: 0 }
  const end = { x: -1, y: 0 }

  /*
   * Not derivable from the endpoints: both sweeps join the same two points.
   * What decides it is whether the third point lies on the counterclockwise one.
   */
  it('goes the way the third point is', () => {
    expect(threePointArcDirection(center, start, end, { x: 0, y: 1 })).toBe(
      'ccw'
    )
    expect(threePointArcDirection(center, start, end, { x: 0, y: -1 })).toBe(
      'cw'
    )
  })

  it('counts a point at the end of the sweep as on it', () => {
    expect(threePointArcDirection(center, start, end, end)).toBe('ccw')
  })
})

describe('the midpoint', () => {
  it('is halfway, which is where a fresh arc puts its centre', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 4, y: 8 })).toEqual({ x: 2, y: 4 })
  })
})
