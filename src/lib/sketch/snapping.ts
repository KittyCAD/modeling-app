import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'
import type { SketchDrawing } from '@src/lib/sketch/drawing'
import { hitsInSketch } from '@src/lib/sketch/hitTest'

/**
 * What the pointer would snap to.
 *
 * Ported from `src/machines/sketchSolve/snapping.ts`. The targets, the priority
 * order and the exclusion rule are the existing app's; what is left out is the
 * half that turns a target into a *constraint* — snapping there does not merely
 * move the point, it writes a coincidence — which needs `add_constraint` wired
 * and is the next piece rather than this one.
 *
 * Even without that, snapping is what makes a sketch drawable: a click that
 * lands 0.3mm from an endpoint should mean the endpoint, and a line that looks
 * horizontal should be horizontal.
 */

export const ORIGIN_TARGET = 'origin'
export const X_AXIS_TARGET = 'x-axis'
export const Y_AXIS_TARGET = 'y-axis'

/** Something in the sketch that the pointer is near. */
interface CoincidentSnapTarget {
  type: 'point' | 'line' | 'midpoint' | 'arc' | 'circle'
  id: ApiObjectId
}

export type SnapTarget =
  | CoincidentSnapTarget
  | { type: typeof ORIGIN_TARGET }
  | { type: typeof X_AXIS_TARGET | typeof Y_AXIS_TARGET }

export interface SnappingCandidate {
  target: SnapTarget
  distance: number
  /** Where the point would go, which is not where the pointer is. */
  position: PlanePoint
}

/**
 * Shift means "no, I meant here".
 *
 * A modifier rather than a mode, because wanting to place a point *near* a
 * feature without attaching to it is a per-click intention. The existing app's
 * `allowSnapping`.
 */
export const allowSnapping = (event: { shiftKey: boolean }) => !event.shiftKey

/**
 * Which target wins when several are in reach.
 *
 * `getSnapTargetPriority`, and the order is worth reading: a point beats the
 * origin, the origin beats the axes, the axes beat a midpoint, and a midpoint
 * beats the body of the curve it is on. Every one of those is "the more specific
 * thing you probably meant" — landing on a curve is easy and landing on the
 * exact end of one is not, so the hard target is offered first.
 */
function priorityOf(target: SnapTarget): number {
  switch (target.type) {
    case 'point':
      return 0
    case ORIGIN_TARGET:
      return 1
    case X_AXIS_TARGET:
    case Y_AXIS_TARGET:
      return 2
    case 'midpoint':
      return 3
    default:
      return 4
  }
}

export interface SnappingOptions {
  /**
   * Points that must not be snapped to.
   *
   * The point being dragged is the obvious one — a draft point snapping to
   * itself would pin it where it started — and the existing app also excludes
   * the *other* end of the segment being drawn, so a line cannot collapse onto
   * its own start.
   */
  exclude?: ReadonlySet<ApiObjectId>
}

/**
 * Everything the pointer could snap to, best first.
 *
 * `tolerance` is in plane units, converted from pixels by whoever knows the
 * zoom, so the reach is a constant number of pixels at any magnification.
 */
export function snappingCandidates(
  drawing: SketchDrawing,
  at: PlanePoint,
  tolerance: number,
  options: SnappingOptions = {}
): readonly SnappingCandidate[] {
  const exclude = options.exclude ?? new Set<ApiObjectId>()
  const shapes = new Map(drawing.shapes.map((shape) => [shape.id, shape]))
  const candidates: SnappingCandidate[] = []

  for (const hit of hitsInSketch(drawing, at, tolerance)) {
    if (exclude.has(hit.id)) continue

    if (hit.kind === 'vertex') {
      candidates.push({
        target: { type: 'point', id: hit.id },
        distance: hit.distance,
        position: hit.closest,
      })
      continue
    }

    const shape = shapes.get(hit.id)
    if (!shape) continue

    if (shape.kind === 'line') {
      candidates.push({
        target: { type: 'line', id: hit.id },
        distance: hit.distance,
        position: hit.closest,
      })

      /*
       * And its midpoint, which is a target in its own right.
       *
       * Offered separately rather than as part of the line, because it carries a
       * different constraint: on the line versus at the middle of it.
       */
      const midpoint = {
        x: (shape.from.x + shape.to.x) / 2,
        y: (shape.from.y + shape.to.y) / 2,
      }
      const toMidpoint = Math.hypot(at.x - midpoint.x, at.y - midpoint.y)
      if (toMidpoint <= tolerance) {
        candidates.push({
          target: { type: 'midpoint', id: hit.id },
          distance: toMidpoint,
          position: midpoint,
        })
      }
      continue
    }

    if (shape.kind === 'arc' || shape.kind === 'circle') {
      candidates.push({
        target: { type: shape.kind, id: hit.id },
        distance: hit.distance,
        position: hit.closest,
      })
    }
  }

  /*
   * The origin and the two axes, which are not in the graph.
   *
   * They are the sketch's own frame rather than geometry somebody drew, and they
   * are the most useful targets there are — almost every sketch starts at the
   * origin or lines something up with an axis. Distance to an axis is the
   * perpendicular one, so it is simply the other coordinate.
   */
  const toOrigin = Math.hypot(at.x, at.y)
  if (toOrigin <= tolerance) {
    candidates.push({
      target: { type: ORIGIN_TARGET },
      distance: toOrigin,
      position: { x: 0, y: 0 },
    })
  }

  if (Math.abs(at.y) <= tolerance) {
    candidates.push({
      target: { type: X_AXIS_TARGET },
      distance: Math.abs(at.y),
      position: { x: at.x, y: 0 },
    })
  }

  if (Math.abs(at.x) <= tolerance) {
    candidates.push({
      target: { type: Y_AXIS_TARGET },
      distance: Math.abs(at.x),
      position: { x: 0, y: at.y },
    })
  }

  return candidates.sort((a, b) => {
    const byPriority = priorityOf(a.target) - priorityOf(b.target)
    return byPriority !== 0 ? byPriority : a.distance - b.distance
  })
}

/** The one to use, or null when nothing is in reach. */
export function bestSnappingCandidate(
  drawing: SketchDrawing,
  at: PlanePoint,
  tolerance: number,
  options: SnappingOptions = {}
): SnappingCandidate | null {
  return snappingCandidates(drawing, at, tolerance, options)[0] ?? null
}

/** Where a click should actually land: the snap if there is one, else the pointer. */
export const snappedPosition = (
  candidate: SnappingCandidate | null,
  at: PlanePoint
): PlanePoint => candidate?.position ?? at

/** For drawing the guide line an axis snap implies. */
export const isAxisSnapTarget = (target: SnapTarget | null | undefined) =>
  target?.type === X_AXIS_TARGET || target?.type === Y_AXIS_TARGET
