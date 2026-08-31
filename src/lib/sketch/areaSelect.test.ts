import { describe, expect, it } from 'vitest'
import {
  arcExtremes,
  lineTouchesBox,
  modeFor,
  rimTouchesBox,
  segmentsInBox,
} from '@src/lib/sketch/areaSelect'
import type { SketchDrawing, SketchShape } from '@src/lib/sketch/drawing'

const box = (fromX: number, fromY: number, toX: number, toY: number) => ({
  from: { x: fromX, y: fromY },
  to: { x: toX, y: toY },
})

const line = (
  id: number,
  from: { x: number; y: number },
  to: { x: number; y: number }
): SketchShape => ({
  id,
  construction: false,
  freedom: 'Free',
  kind: 'line',
  from,
  to,
})

const circle = (
  id: number,
  center: { x: number; y: number },
  radius: number
): SketchShape => ({
  id,
  construction: false,
  freedom: 'Free',
  kind: 'circle',
  center,
  radius,
})

const arc = (
  id: number,
  overrides: Partial<Extract<SketchShape, { kind: 'arc' }>> = {}
): SketchShape => ({
  id,
  construction: false,
  freedom: 'Free',
  kind: 'arc',
  center: { x: 0, y: 0 },
  start: { x: 10, y: 0 },
  end: { x: -10, y: 0 },
  radius: 10,
  clockwise: false,
  ...overrides,
})

const drawingOf = (
  shapes: readonly SketchShape[],
  vertices: SketchDrawing['vertices'] = []
): SketchDrawing => ({ shapes, vertices })

describe('which reading a drag means', () => {
  /*
   * A CAD convention older than any of these apps, and read off the direction the
   * hand went rather than from a modifier.
   */
  it('is crossing right to left and contains left to right', () => {
    expect(modeFor(100, 40)).toBe('crossing')
    expect(modeFor(40, 100)).toBe('contains')
  })

  it('is contains when the drag is straight down', () => {
    expect(modeFor(50, 50)).toBe('contains')
  })
})

describe('whether a line touches a box', () => {
  const region = box(0, 0, 10, 10)

  it('touches when an end is inside', () => {
    expect(lineTouchesBox({ x: 5, y: 5 }, { x: 50, y: 50 }, region)).toBe(true)
  })

  /*
   * The case an endpoint test misses, and the reason the crossing reading needs
   * real arithmetic: a line straight through with both ends well outside.
   */
  it('touches when it passes straight through', () => {
    expect(lineTouchesBox({ x: -10, y: 5 }, { x: 20, y: 5 }, region)).toBe(true)
  })

  it('touches on a corner', () => {
    expect(lineTouchesBox({ x: -5, y: 5 }, { x: 5, y: -5 }, region)).toBe(true)
  })

  it('does not touch when it passes by', () => {
    expect(lineTouchesBox({ x: -10, y: 20 }, { x: 20, y: 20 }, region)).toBe(
      false
    )
  })

  it('does not care which way round the box was dragged', () => {
    expect(
      lineTouchesBox({ x: -10, y: 5 }, { x: 20, y: 5 }, box(10, 10, 0, 0))
    ).toBe(true)
  })
})

describe('whether an arc or a circle touches a box', () => {
  it('touches a box its rim crosses', () => {
    expect(
      rimTouchesBox(circle(0, { x: 0, y: 0 }, 10) as never, box(8, -2, 12, 2))
    ).toBe(true)
  })

  /*
   * The interesting case: a box entirely *inside* a circle touches nothing. The
   * rim is the circle; its middle is not.
   */
  it('does not touch a box floating inside it', () => {
    expect(
      rimTouchesBox(circle(0, { x: 0, y: 0 }, 10) as never, box(-2, -2, 2, 2))
    ).toBe(false)
  })

  /*
   * An arc is not its circle. A box beside the part that is missing touches
   * nothing, which is why the sweep is tested and not just the radius.
   */
  it('does not touch a box beside the part of the circle the arc leaves out', () => {
    // The upper half, from (10,0) round to (-10,0) counterclockwise.
    expect(rimTouchesBox(arc(0) as never, box(-2, -12, 2, -8))).toBe(false)
    expect(rimTouchesBox(arc(0) as never, box(-2, 8, 2, 12))).toBe(true)
  })

  it('touches when one of its ends is inside', () => {
    expect(rimTouchesBox(arc(0) as never, box(8, -2, 12, 2))).toBe(true)
  })
})

describe('what an arc has to have inside to be contained', () => {
  /*
   * Testing only the ends would call a half circle contained by a box its bulge
   * sticks out of.
   */
  /** Near enough: a compass point is `cos(π/2) * r` from zero, not zero. */
  const includes = (
    points: readonly { x: number; y: number }[],
    at: { x: number; y: number }
  ) =>
    points.some(
      (point) =>
        Math.abs(point.x - at.x) < 1e-9 && Math.abs(point.y - at.y) < 1e-9
    )

  it('counts the bulge, not just the ends', () => {
    expect(includes(arcExtremes(arc(0) as never), { x: 0, y: 10 })).toBe(true)
  })

  it('leaves out the compass points the sweep does not reach', () => {
    expect(includes(arcExtremes(arc(0) as never), { x: 0, y: -10 })).toBe(false)
  })
})

describe('what a box selects', () => {
  const shapes = [
    // Wholly inside a 0..10 box.
    line(1, { x: 2, y: 2 }, { x: 8, y: 8 }),
    // Half in, half out.
    line(2, { x: 5, y: 5 }, { x: 50, y: 50 }),
    // Nowhere near.
    line(3, { x: 80, y: 80 }, { x: 90, y: 90 }),
  ]

  it('takes only what is wholly inside, dragged left to right', () => {
    expect(
      segmentsInBox(drawingOf(shapes), box(0, 0, 10, 10), 'contains')
    ).toEqual([1])
  })

  it('takes everything it touches, dragged right to left', () => {
    expect(
      segmentsInBox(drawingOf(shapes), box(0, 0, 10, 10), 'crossing')
    ).toEqual([1, 2])
  })

  it('takes the points inside it', () => {
    const vertices = [
      { id: 7, at: { x: 3, y: 3 }, freedom: 'Free' as const, owner: null },
      { id: 8, at: { x: 30, y: 3 }, freedom: 'Free' as const, owner: null },
    ]

    expect(
      segmentsInBox(drawingOf([], vertices), box(0, 0, 10, 10), 'contains')
    ).toEqual([7])
  })

  /*
   * A point that belongs to a segment — a spline's control point, a rectangle's
   * corner — is not the thing to select: its owner is.
   */
  it('leaves out a point that belongs to a segment', () => {
    const vertices = [
      { id: 7, at: { x: 3, y: 3 }, freedom: 'Free' as const, owner: 9 },
    ]

    expect(
      segmentsInBox(drawingOf([], vertices), box(0, 0, 10, 10), 'contains')
    ).toEqual([])
  })

  it('answers in id order, so the same box always gives the same selection', () => {
    const reversed = [shapes[2], shapes[1], shapes[0]] as SketchShape[]

    expect(
      segmentsInBox(drawingOf(reversed), box(0, 0, 10, 10), 'crossing')
    ).toEqual([1, 2])
  })

  it('selects nothing from an empty box', () => {
    expect(
      segmentsInBox(drawingOf(shapes), box(4, 4, 4, 4), 'contains')
    ).toEqual([])
  })
})
