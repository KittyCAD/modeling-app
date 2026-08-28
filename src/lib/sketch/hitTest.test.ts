import { describe, expect, it } from 'vitest'
import type { SketchDrawing, SketchShape } from '@src/lib/sketch/drawing'
import { distanceToShape, pickInSketch } from '@src/lib/sketch/hitTest'

const line: SketchShape = {
  kind: 'line',
  id: 1,
  from: { x: 0, y: 0 },
  to: { x: 10, y: 0 },
  construction: false,
  freedom: 'Free',
}

const circle: SketchShape = {
  kind: 'circle',
  id: 2,
  center: { x: 0, y: 0 },
  radius: 5,
  construction: false,
  freedom: 'Free',
}

/** The quarter turn from +X round to +Y. */
const arc: SketchShape = {
  kind: 'arc',
  id: 3,
  center: { x: 0, y: 0 },
  start: { x: 5, y: 0 },
  end: { x: 0, y: 5 },
  radius: 5,
  clockwise: false,
  construction: false,
  freedom: 'Free',
}

describe('distanceToShape', () => {
  it('measures to a line’s body, not to the infinite line through it', () => {
    expect(distanceToShape(line, { x: 5, y: 3 })).toBe(3)
    // Off the end: the nearest part of the segment is the end itself.
    expect(distanceToShape(line, { x: 14, y: 0 })).toBe(4)
  })

  it('measures a circle from its rim, inside and out', () => {
    expect(distanceToShape(circle, { x: 7, y: 0 })).toBe(2)
    expect(distanceToShape(circle, { x: 3, y: 0 })).toBe(2)
    // The centre is as far from the rim as the radius, not on the shape.
    expect(distanceToShape(circle, { x: 0, y: 0 })).toBe(5)
  })

  it('measures an arc from its rim only within its sweep', () => {
    expect(distanceToShape(arc, { x: 0, y: 7 })).toBe(2)
    // Below the start: outside the quarter turn, so the start is nearest.
    expect(distanceToShape(arc, { x: 5, y: -3 })).toBeCloseTo(3)
  })

  it('honours which way an arc goes round', () => {
    const clockwise: SketchShape = { ...arc, clockwise: true }
    const behind = { x: -7, y: 0 }

    // Counter-clockwise from +X to +Y does not reach -X; clockwise does.
    expect(distanceToShape(arc, behind)).toBeGreaterThan(2)
    expect(distanceToShape(clockwise, behind)).toBe(2)
  })

  it('reads an arc that closes on itself as a whole turn', () => {
    const closed: SketchShape = { ...arc, end: { x: 5, y: 0 } }
    // Otherwise a full arc would be unpickable everywhere, which reads as it
    // not being there.
    expect(distanceToShape(closed, { x: -7, y: 0 })).toBe(2)
  })

  it('measures a polyline to its nearest leg', () => {
    const polyline: SketchShape = {
      kind: 'polyline',
      id: 4,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      construction: false,
      freedom: 'Free',
    }

    expect(distanceToShape(polyline, { x: 12, y: 5 })).toBe(2)
  })
})

const drawing: SketchDrawing = {
  shapes: [line],
  vertices: [
    { id: 10, at: { x: 0, y: 0 }, freedom: 'Fixed' },
    { id: 11, at: { x: 10, y: 0 }, freedom: 'Free' },
  ],
}

describe('pickInSketch', () => {
  it('finds nothing in empty space', () => {
    expect(pickInSketch(drawing, { x: 5, y: 50 }, 1)).toBeNull()
  })

  it('finds the segment along its body', () => {
    expect(pickInSketch(drawing, { x: 5, y: 0.5 }, 1)).toMatchObject({
      kind: 'segment',
      id: 1,
    })
  })

  it('prefers a vertex to the segment it sits on', () => {
    // The end of a line is the thing you drag and constrain; the line is still
    // reachable everywhere else along it.
    expect(pickInSketch(drawing, { x: 9.8, y: 0 }, 1)).toMatchObject({
      kind: 'vertex',
      id: 11,
    })
  })

  it('takes the nearest of two vertices in reach', () => {
    const crowded: SketchDrawing = {
      shapes: [],
      vertices: [
        { id: 10, at: { x: 0, y: 0 }, freedom: 'Free' },
        { id: 11, at: { x: 1, y: 0 }, freedom: 'Free' },
      ],
    }

    expect(pickInSketch(crowded, { x: 0.6, y: 0 }, 2)).toMatchObject({ id: 11 })
  })

  it('picks nothing at all when the tolerance is zero', () => {
    // Which is what an edge-on plane reports, and it must read as "do not pick
    // here" rather than as a very small tolerance.
    expect(pickInSketch(drawing, { x: 5, y: 0.01 }, 0)).toBeNull()
  })
})
