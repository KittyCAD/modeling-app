import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'
import type { SketchDrawing, SketchShape } from '@src/lib/sketch/drawing'

/**
 * Selecting by dragging a box.
 *
 * Ported from `areaSelectUtils.ts`, and the important part is the *two* modes,
 * which are a CAD convention older than any of these apps:
 *
 *  - drag **left to right** and you get what is entirely inside the box;
 *  - drag **right to left** and you get everything the box touches.
 *
 * Both are useful for different jobs — one to grab a feature whole, one to grab
 * everything across a region — and which you meant is read off the direction your
 * hand went rather than from a modifier. The existing app decides it from screen
 * x, so a caller passes the mode in: this file works in the sketch plane, where
 * "left" is not a fact.
 *
 * Everything here is arithmetic over the same shapes the drawing and the hit test
 * use, so what the box selects is what you can see it touching.
 */

/** A box in the sketch plane, from the press to the pointer. */
export interface SelectionBox {
  from: PlanePoint
  to: PlanePoint
}

export type AreaSelectMode =
  /** Only what is wholly inside. Dragged left to right. */
  | 'contains'
  /** Anything the box touches. Dragged right to left. */
  | 'crossing'

/** Which mode a drag means, from where it started and where it is on screen. */
export const modeFor = (
  fromScreenX: number,
  toScreenX: number
): AreaSelectMode => (fromScreenX > toScreenX ? 'crossing' : 'contains')

interface Bounds {
  min: PlanePoint
  max: PlanePoint
}

const boundsOf = (box: SelectionBox): Bounds => ({
  min: { x: Math.min(box.from.x, box.to.x), y: Math.min(box.from.y, box.to.y) },
  max: { x: Math.max(box.from.x, box.to.x), y: Math.max(box.from.y, box.to.y) },
})

const inside = (point: PlanePoint, bounds: Bounds) =>
  point.x >= bounds.min.x &&
  point.x <= bounds.max.x &&
  point.y >= bounds.min.y &&
  point.y <= bounds.max.y

/**
 * Whether a finite line touches an axis-aligned box.
 *
 * `doesLineSegmentIntersectBox`: an endpoint inside is enough, and otherwise each
 * of the four edges is tested by solving the parametric line for that edge's
 * coordinate and checking the crossing falls within both the segment and the
 * edge. Cheaper than clipping, and it answers the only question being asked.
 */
export function lineTouchesBox(
  from: PlanePoint,
  to: PlanePoint,
  box: SelectionBox
): boolean {
  const bounds = boundsOf(box)
  if (inside(from, bounds) || inside(to, bounds)) return true

  const dx = to.x - from.x
  const dy = to.y - from.y

  if (dx !== 0) {
    for (const x of [bounds.min.x, bounds.max.x]) {
      const t = (x - from.x) / dx
      if (t < 0 || t > 1) continue
      const y = from.y + t * dy
      if (y >= bounds.min.y && y <= bounds.max.y) return true
    }
  }

  if (dy !== 0) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      const t = (y - from.y) / dy
      if (t < 0 || t > 1) continue
      const x = from.x + t * dx
      if (x >= bounds.min.x && x <= bounds.max.x) return true
    }
  }

  return false
}

const TAU = Math.PI * 2

const normalise = (angle: number) => ((angle % TAU) + TAU) % TAU

const angleOf = (center: PlanePoint, point: PlanePoint) =>
  Math.atan2(point.y - center.y, point.x - center.x)

/** How far round it is from the arc's start to an angle, the way it sweeps. */
function sweepTo(shape: Arc, angle: number): number {
  const start = angleOf(shape.center, shape.start)
  return shape.clockwise ? normalise(start - angle) : normalise(angle - start)
}

type Arc = Extract<SketchShape, { kind: 'arc' }>
type Circle = Extract<SketchShape, { kind: 'circle' }>

/** The whole sweep, with start meeting end read as a full turn. */
function sweepOf(shape: Arc): number {
  const swept = sweepTo(shape, angleOf(shape.center, shape.end))
  return swept === 0 ? TAU : swept
}

/**
 * The points that decide whether an arc is *contained*.
 *
 * `getContainedArcPoints`: its two ends, plus wherever it crosses the compass
 * points, because those are the extremes of its bounding box. Testing only the
 * ends would call a half circle contained by a box its bulge sticks out of.
 */
export function arcExtremes(shape: Arc): readonly PlanePoint[] {
  if (shape.radius === 0) return [shape.start, shape.end]

  const sweep = sweepOf(shape)
  const compass = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]

  return [
    shape.start,
    shape.end,
    ...compass
      .filter((angle) => sweepTo(shape, angle) <= sweep)
      .map((angle) => ({
        x: shape.center.x + Math.cos(angle) * shape.radius,
        y: shape.center.y + Math.sin(angle) * shape.radius,
      })),
  ]
}

/** Below this an arc's crossing counts as on it. The existing app's epsilon. */
const EPSILON = 1e-9

/**
 * Whether an arc or a circle touches a box.
 *
 * `doesArcIntersectBox`. The rim is solved against each of the box's four lines —
 * a circle of radius r centred at c crosses the vertical x = k at
 * y = c.y ± √(r² − (k − c.x)²) — and each crossing is kept only if it lands
 * within the box *and* within the arc's own sweep. An arc is not its circle, and
 * a box beside the missing part of one touches nothing.
 */
export function rimTouchesBox(shape: Arc | Circle, box: SelectionBox): boolean {
  const bounds = boundsOf(box)
  const { center, radius } = shape

  if (shape.kind === 'arc') {
    if (inside(shape.start, bounds) || inside(shape.end, bounds)) return true
  }
  if (radius === 0) return false

  const sweep = shape.kind === 'arc' ? sweepOf(shape) : TAU

  const onRim = (point: PlanePoint) => {
    if (
      point.x < bounds.min.x - EPSILON ||
      point.x > bounds.max.x + EPSILON ||
      point.y < bounds.min.y - EPSILON ||
      point.y > bounds.max.y + EPSILON
    ) {
      return false
    }

    if (shape.kind === 'circle') return true
    return sweepTo(shape, angleOf(center, point)) <= sweep + EPSILON
  }

  for (const x of [bounds.min.x, bounds.max.x]) {
    const offsetSquared = radius * radius - (x - center.x) ** 2
    if (offsetSquared < 0) continue

    const offset = Math.sqrt(offsetSquared)
    if (
      onRim({ x, y: center.y + offset }) ||
      onRim({ x, y: center.y - offset })
    ) {
      return true
    }
  }

  for (const y of [bounds.min.y, bounds.max.y]) {
    const offsetSquared = radius * radius - (y - center.y) ** 2
    if (offsetSquared < 0) continue

    const offset = Math.sqrt(offsetSquared)
    if (
      onRim({ x: center.x + offset, y }) ||
      onRim({ x: center.x - offset, y })
    ) {
      return true
    }
  }

  return false
}

/** Every point a shape has to have inside the box to count as contained. */
function extentOf(shape: SketchShape): readonly PlanePoint[] {
  switch (shape.kind) {
    case 'line':
      return [shape.from, shape.to]
    case 'arc':
      return arcExtremes(shape)
    case 'circle':
      return [
        { x: shape.center.x + shape.radius, y: shape.center.y },
        { x: shape.center.x - shape.radius, y: shape.center.y },
        { x: shape.center.x, y: shape.center.y + shape.radius },
        { x: shape.center.x, y: shape.center.y - shape.radius },
      ]
    case 'polyline':
      return shape.points
  }
}

/** Whether the box touches a shape at all. */
function touches(shape: SketchShape, box: SelectionBox): boolean {
  switch (shape.kind) {
    case 'line':
      return lineTouchesBox(shape.from, shape.to, box)
    case 'arc':
    case 'circle':
      return rimTouchesBox(shape, box)
    case 'polyline':
      return shape.points.some(
        (point, index) =>
          index > 0 &&
          lineTouchesBox(shape.points[index - 1] as PlanePoint, point, box)
      )
  }
}

/**
 * What a box selects.
 *
 * Points and whole segments, never both halves of the same thing: a point that
 * *belongs* to a segment — a spline's control point, a rectangle's corner — is
 * left out, because the thing to select there is the segment that owns it. The
 * existing app skips owned points for the same reason.
 *
 * Ordered by id rather than by what the box met first, so the same box always
 * gives the same selection.
 */
export function segmentsInBox(
  drawing: SketchDrawing,
  box: SelectionBox,
  mode: AreaSelectMode
): readonly ApiObjectId[] {
  const bounds = boundsOf(box)
  const found = new Set<ApiObjectId>()

  for (const vertex of drawing.vertices) {
    if (vertex.owner !== null) continue
    if (inside(vertex.at, bounds)) found.add(vertex.id)
  }

  for (const shape of drawing.shapes) {
    const selected =
      mode === 'crossing'
        ? touches(shape, box)
        : extentOf(shape).every((point) => inside(point, bounds))

    if (selected) found.add(shape.id)
  }

  return [...found].sort((a, b) => a - b)
}
