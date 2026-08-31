import type {
  ApiObjectId,
  Freedom,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { millimetres } from '@src/lib/kcl/units'
import type { PlanePoint } from '@src/lib/scene/projection'
import { type SketchPoint, segmentsOf } from '@src/lib/sketch/sceneGraph'

/**
 * A sketch, as shapes rather than as a graph.
 *
 * The one step between the frontend's model and anything that draws it, and it
 * is deliberately a *pure function*: a renderer takes shapes and puts them on a
 * surface, and never learns that a line is two point ids or that a circle keeps
 * a point on its rim. Which is what lets the same shapes feed the hit testing —
 * picking a segment is then arithmetic over the same values that were drawn,
 * rather than a second traversal that can disagree with the first.
 *
 * Millimetres, because that is where the plane frame and the camera are. The
 * graph reports whatever the file was written in and every position converts on
 * the way through.
 */

/** A vertex somebody can grab. */
export interface SketchVertex {
  id: ApiObjectId
  at: PlanePoint
  freedom: Freedom
}

interface ShapeBase {
  /** The segment's id, which is what a selection or a drag is addressed to. */
  id: ApiObjectId
  construction: boolean
  /** Null when the solver has said nothing, which is drawn as unconstrained. */
  freedom: Freedom | null
}

export type SketchShape =
  | (ShapeBase & { kind: 'line'; from: PlanePoint; to: PlanePoint })
  | (ShapeBase & {
      kind: 'arc'
      center: PlanePoint
      start: PlanePoint
      end: PlanePoint
      radius: number
      clockwise: boolean
    })
  | (ShapeBase & { kind: 'circle'; center: PlanePoint; radius: number })
  /**
   * A spline, drawn as its control polygon.
   *
   * Honest rather than pretty: evaluating the curve is the solver's arithmetic
   * and guessing at it here would draw something the model does not contain.
   * Replaced when the graph reports evaluated points, and until then a spline is
   * visible and grabbable rather than absent.
   */
  | (ShapeBase & { kind: 'polyline'; points: readonly PlanePoint[] })

/** Everything drawn for one sketch, and every vertex in it. */
export interface SketchDrawing {
  shapes: readonly SketchShape[]
  vertices: readonly SketchVertex[]
}

const positionOf = (point: SketchPoint): PlanePoint => ({
  x: millimetres(point.x, point.units),
  y: millimetres(point.y, point.units),
})

const distance = (a: PlanePoint, b: PlanePoint) =>
  Math.hypot(b.x - a.x, b.y - a.y)

/**
 * One sketch's shapes and vertices.
 *
 * Total: a segment whose points the graph has lost is skipped rather than drawn
 * at the origin. A solve part way through is a normal thing to be handed, and
 * half a sketch drawn correctly beats a whole one drawn wrong.
 */
export function drawingOf(
  graph: SceneGraph,
  sketchId: ApiObjectId
): SketchDrawing {
  const shapes: SketchShape[] = []
  const vertices = new Map<ApiObjectId, SketchVertex>()

  for (const segment of segmentsOf(graph, sketchId)) {
    for (const point of segment.points) {
      vertices.set(point.id, {
        id: point.id,
        at: positionOf(point),
        freedom: point.freedom,
      })
    }

    const base = {
      id: segment.id,
      construction: segment.construction,
      freedom: segment.freedom,
    }
    const places = segment.points.map(positionOf)

    switch (segment.segment.type) {
      case 'Line': {
        const [from, to] = places
        if (from && to) shapes.push({ ...base, kind: 'line', from, to })
        break
      }

      case 'Arc': {
        // The graph names them start, end, centre, in that order.
        const [start, end, center] = places
        if (!start || !end || !center) break
        shapes.push({
          ...base,
          kind: 'arc',
          start,
          end,
          center,
          radius: distance(center, start),
          // Counter-clockwise is the default the graph omits.
          clockwise: segment.segment.direction === 'cw',
        })
        break
      }

      case 'Circle': {
        // A circle is a centre and a point on the rim, so the radius is the gap
        // between them rather than a number of its own.
        const [rim, center] = places
        if (!rim || !center) break
        shapes.push({
          ...base,
          kind: 'circle',
          center,
          radius: distance(center, rim),
        })
        break
      }

      case 'ControlPointSpline': {
        if (places.length >= 2) {
          shapes.push({ ...base, kind: 'polyline', points: places })
        }
        break
      }

      case 'Point':
        // Already a vertex, and nothing else. A point somebody placed is drawn
        // by being grabbable, not by having a shape.
        break
    }
  }

  return { shapes, vertices: [...vertices.values()] }
}

/**
 * A shape as a chain of points in the plane.
 *
 * Curves are sampled rather than handed to the renderer as curves, and that is a
 * decision rather than a shortcut: an ellipse projects to an ellipse only under
 * an orthographic camera, so an SVG `circle` would be visibly wrong the moment
 * somebody switched to perspective and looked at the sketch from an angle. A
 * chain of points is right under any projection, and it is the same chain the
 * hit testing already measures against.
 *
 * `resolution` is the number of samples in a whole turn. The default is fine at
 * any zoom a sketch is worked at; a curve that fills the screen would want more.
 */
export function flatten(
  shape: SketchShape,
  resolution = 64
): readonly PlanePoint[] {
  switch (shape.kind) {
    case 'line':
      return [shape.from, shape.to]

    case 'polyline':
      return shape.points

    case 'circle':
      return sampleArc(shape.center, shape.radius, 0, Math.PI * 2, resolution)

    case 'arc': {
      const start = Math.atan2(
        shape.start.y - shape.center.y,
        shape.start.x - shape.center.x
      )
      const end = Math.atan2(
        shape.end.y - shape.center.y,
        shape.end.x - shape.center.x
      )

      let sweep = shape.clockwise ? start - end : end - start
      sweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      // Start and end meeting means a closed arc, not an empty one.
      if (sweep === 0) sweep = Math.PI * 2

      return sampleArc(
        shape.center,
        shape.radius,
        start,
        shape.clockwise ? -sweep : sweep,
        resolution
      )
    }
  }
}

function sampleArc(
  center: PlanePoint,
  radius: number,
  from: number,
  sweep: number,
  resolution: number
): PlanePoint[] {
  // At least two, so a very short arc is still a line rather than a dot.
  const steps = Math.max(
    2,
    Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * resolution)
  )

  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + (sweep * index) / steps
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    }
  })
}
