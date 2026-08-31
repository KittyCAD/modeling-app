import { describe, expect, it } from 'vitest'
import type { SketchDrawing } from '@src/lib/sketch/drawing'
import {
  ORIGIN_TARGET,
  X_AXIS_TARGET,
  Y_AXIS_TARGET,
  allowSnapping,
  bestSnappingCandidate,
  isAxisSnapTarget,
  snappedPosition,
  snappingCandidates,
} from '@src/lib/sketch/snapping'

/** A line from (20,20) to (40,20), with both ends as vertices. */
const drawing: SketchDrawing = {
  shapes: [
    {
      kind: 'line',
      id: 1,
      from: { x: 20, y: 20 },
      to: { x: 40, y: 20 },
      construction: false,
      freedom: 'Free',
    },
  ],
  vertices: [
    { id: 2, at: { x: 20, y: 20 }, freedom: 'Free' },
    { id: 3, at: { x: 40, y: 20 }, freedom: 'Free' },
  ],
}

const targets = (at: { x: number; y: number }, tolerance = 5) =>
  snappingCandidates(drawing, at, tolerance).map(
    (candidate) => candidate.target.type
  )

describe('snappingCandidates', () => {
  it('finds an endpoint before the line it is on', () => {
    // Landing on a curve is easy; landing on the exact end of one is not, so the
    // hard target is offered first.
    expect(targets({ x: 21, y: 20 })).toEqual(['point', 'line'])
  })

  it('offers the origin, which is in no graph', () => {
    expect(targets({ x: 1, y: 1 })).toContain(ORIGIN_TARGET)
    expect(bestSnappingCandidate(drawing, { x: 1, y: 1 }, 5)?.position).toEqual(
      { x: 0, y: 0 }
    )
  })

  it('offers each axis by perpendicular distance', () => {
    // Well away from the origin, so only one axis is in reach.
    expect(targets({ x: 200, y: 2 })).toContain(X_AXIS_TARGET)
    expect(targets({ x: 200, y: 2 })).not.toContain(Y_AXIS_TARGET)

    const onAxis = bestSnappingCandidate(drawing, { x: 200, y: 2 }, 5)
    // Snapping to the X axis keeps x and drops y to zero.
    expect(onAxis?.position).toEqual({ x: 200, y: 0 })
  })

  it('offers a line’s midpoint as a target of its own', () => {
    // A different constraint from "on the line": at the middle of it.
    const found = targets({ x: 30, y: 21 })
    expect(found).toContain('midpoint')
    expect(found.indexOf('midpoint')).toBeLessThan(found.indexOf('line'))
  })

  it('puts a point above the origin, the origin above the axes, and the axes above a midpoint', () => {
    const line: SketchDrawing = {
      shapes: [
        {
          kind: 'line',
          id: 1,
          from: { x: -4, y: 0 },
          to: { x: 4, y: 0 },
          construction: false,
          freedom: 'Free',
        },
      ],
      vertices: [{ id: 2, at: { x: 1, y: 1 }, freedom: 'Free' }],
    }

    // Everything within reach at once: the order is the whole point.
    expect(
      snappingCandidates(line, { x: 0.5, y: 0.5 }, 5).map((c) => c.target.type)
    ).toEqual([
      'point',
      ORIGIN_TARGET,
      X_AXIS_TARGET,
      Y_AXIS_TARGET,
      'midpoint',
      'line',
    ])
  })

  it('finds nothing out of reach', () => {
    expect(targets({ x: 500, y: 500 })).toEqual([])
  })

  /*
   * A draft point snapping to itself would pin it where it started, and the
   * other end of the segment being drawn would let a line collapse onto it.
   */
  it('leaves out the points it was told to', () => {
    const found = snappingCandidates(drawing, { x: 20, y: 20 }, 5, {
      exclude: new Set([2]),
    })

    expect(found.map((candidate) => candidate.target)).not.toContainEqual({
      type: 'point',
      id: 2,
    })
  })
})

describe('allowSnapping', () => {
  it('is off while shift is held', () => {
    // Placing a point *near* a feature without attaching to it is a per-click
    // intention, so it is a modifier rather than a mode.
    expect(allowSnapping({ shiftKey: false })).toBe(true)
    expect(allowSnapping({ shiftKey: true })).toBe(false)
  })
})

describe('snappedPosition', () => {
  it('falls back to where the pointer actually is', () => {
    expect(snappedPosition(null, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 })
  })
})

describe('isAxisSnapTarget', () => {
  it('knows the two that want a guide line drawn', () => {
    expect(isAxisSnapTarget({ type: X_AXIS_TARGET })).toBe(true)
    expect(isAxisSnapTarget({ type: 'point', id: 1 })).toBe(false)
    expect(isAxisSnapTarget(null)).toBe(false)
  })
})
