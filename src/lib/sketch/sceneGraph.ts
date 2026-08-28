import type {
  ApiObject,
  ApiObjectId,
  ApiSegment,
  Freedom,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'

/**
 * Reading the scene graph KCL's frontend hands back.
 *
 * `SceneGraph` is the shared representation this whole feature rests on: one
 * flat list of objects — planes, faces, sketches, segments *and* constraints —
 * generated from Rust rather than invented here. Anything that draws a sketch,
 * picks in one, or reasons about one starts by reading it through this module,
 * so a renderer never learns the graph's shape and the graph never learns there
 * is a renderer.
 *
 * Pure and total. A graph from a solve that failed halfway is a normal thing to
 * be handed, so every lookup answers "not there" rather than throwing.
 */

/** A point resolved to plain numbers, which is what a drawing wants. */
export interface SketchPoint {
  id: ApiObjectId
  x: number
  y: number
  freedom: Freedom
}

/** A segment with its points already resolved. */
export interface SketchSegment {
  id: ApiObjectId
  segment: ApiSegment
  /** In the order the segment names them: start, end, centre, controls. */
  points: readonly SketchPoint[]
  construction: boolean
  /**
   * How constrained the whole segment is.
   *
   * `Conflict` beats `Free` beats `Fixed`: a segment is only finished when all of
   * it is, and one point in conflict makes the segment the thing to look at.
   */
  freedom: Freedom
}

/**
 * The object with an id.
 *
 * The graph is a flat array whose index *is* the id, which is worth relying on
 * and worth checking: a stale id from before a renumbering would otherwise read
 * as whatever now occupies that slot.
 */
export function objectAt(
  graph: SceneGraph,
  id: ApiObjectId
): ApiObject | undefined {
  const object = graph.objects[id]
  return object?.id === id ? object : undefined
}

/** The sketch being edited, if the graph says one is. */
export function activeSketch(graph: SceneGraph): ApiObject | undefined {
  if (graph.sketch_mode === null) return undefined

  const object = objectAt(graph, graph.sketch_mode)
  return object?.kind.type === 'Sketch' ? object : undefined
}

/** Point ids a segment is made of, in the order its own type names them. */
function pointIdsOf(segment: ApiSegment): readonly ApiObjectId[] {
  switch (segment.type) {
    case 'Point':
      return []
    case 'Line':
      return [segment.start, segment.end]
    case 'Arc':
      return [segment.start, segment.end, segment.center]
    case 'Circle':
      return [segment.start, segment.center]
    case 'ControlPointSpline':
      return segment.controls
  }
}

/** A point, resolved. Null for an id that is not a point in this graph. */
export function pointAt(
  graph: SceneGraph,
  id: ApiObjectId
): SketchPoint | null {
  const object = objectAt(graph, id)
  if (object?.kind.type !== 'Segment') return null

  const segment = object.kind.segment
  if (segment.type !== 'Point') return null

  return {
    id,
    x: segment.position.x.value,
    y: segment.position.y.value,
    freedom: segment.freedom,
  }
}

const freedomOf = (points: readonly SketchPoint[]): Freedom => {
  if (points.some((point) => point.freedom === 'Conflict')) return 'Conflict'
  if (points.some((point) => point.freedom === 'Free')) return 'Free'
  return 'Fixed'
}

/**
 * One segment, resolved.
 *
 * A standalone point is a segment too — it is how the graph represents a point
 * somebody placed — so it resolves to itself rather than to nothing.
 */
export function segmentAt(
  graph: SceneGraph,
  id: ApiObjectId
): SketchSegment | null {
  const object = objectAt(graph, id)
  if (object?.kind.type !== 'Segment') return null

  const segment = object.kind.segment

  if (segment.type === 'Point') {
    const point = pointAt(graph, id)
    return point
      ? {
          id,
          segment,
          points: [point],
          construction: false,
          freedom: point.freedom,
        }
      : null
  }

  const points = pointIdsOf(segment).flatMap((pointId) => {
    const point = pointAt(graph, pointId)
    return point ? [point] : []
  })

  return {
    id,
    segment,
    points,
    construction: segment.construction,
    freedom: freedomOf(points),
  }
}

/**
 * Everything a sketch is drawn from, resolved and in the sketch's own order.
 *
 * The sketch names its segments, so this follows that list rather than filtering
 * the whole graph: a file with three sketches in it has three of these, and only
 * the one being edited should appear on screen.
 */
export function segmentsOf(
  graph: SceneGraph,
  sketchId: ApiObjectId
): readonly SketchSegment[] {
  const sketch = objectAt(graph, sketchId)
  if (sketch?.kind.type !== 'Sketch') return []

  return sketch.kind.segments.flatMap((id) => {
    const segment = segmentAt(graph, id)
    return segment ? [segment] : []
  })
}

/**
 * The frontend's id for the sketch written at an offset.
 *
 * The bridge between the two ways this app names the same sketch: our side knows
 * a *text range* — the cursor is inside `s = sketch(on = XY) { … }` — and the
 * frontend knows an object id. Every object carries the source it came from, so
 * the crossing is a containment test rather than a second bookkeeping table.
 *
 * The innermost match wins, which matters once sketches can nest inside anything:
 * the smallest range containing the offset is the one the cursor is actually in.
 */
export function sketchIdAt(
  graph: SceneGraph,
  offset: number
): ApiObjectId | null {
  let found: { id: ApiObjectId; width: number } | null = null

  for (const object of graph.objects) {
    if (object?.kind.type !== 'Sketch') continue
    if (object.source.type !== 'Simple') continue

    const [from, to] = object.source.range
    if (offset < from || offset > to) continue

    const width = to - from
    if (!found || width < found.width) found = { id: object.id, width }
  }

  return found?.id ?? null
}

/** The constraints a sketch holds, for drawing them and for asking about them. */
export function constraintsOf(
  graph: SceneGraph,
  sketchId: ApiObjectId
): readonly ApiObject[] {
  const sketch = objectAt(graph, sketchId)
  if (sketch?.kind.type !== 'Sketch') return []

  return sketch.kind.constraints.flatMap((id) => {
    const object = objectAt(graph, id)
    return object?.kind.type === 'Constraint' ? [object] : []
  })
}
