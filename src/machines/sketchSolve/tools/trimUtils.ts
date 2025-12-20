import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'

// Epsilon constants for geometric calculations
const EPSILON_PARALLEL = 1e-10
const EPSILON_POINT_ON_SEGMENT = 1e-6

/**
 * Helper to get point coordinates from a Line segment by looking up the point object
 * Uses the point's position (post-solve) rather than the ctor (pre-solve)
 */
export function getPositionCoordsForLine(
  segment: ApiObject,
  which: 'start' | 'end',
  objects: ApiObject[]
): Coords2d | null {
  if (
    segment?.kind?.type !== 'Segment' ||
    segment.kind.segment.type !== 'Line'
  ) {
    return null
  }

  // Get the point ID from the segment
  const pointId =
    which === 'start' ? segment.kind.segment.start : segment.kind.segment.end

  // Look up the point object - try array index first, then search by object ID
  let point: ApiObject | undefined = objects[pointId]
  if (
    !point ||
    point.kind?.type !== 'Segment' ||
    point.kind.segment.type !== 'Point'
  ) {
    return null
  }

  // Extract coordinates from the point's position
  return [
    point.kind.segment.position.x.value,
    point.kind.segment.position.y.value,
  ]
}

/**
 * Helper to get point coordinates from an Arc segment by looking up the point object
 * Uses the point's position (post-solve) rather than the ctor (pre-solve)
 */
function getPositionCoordsFromArc(
  segment: ApiObject,
  which: 'start' | 'end' | 'center',
  objects: ApiObject[]
): Coords2d | null {
  if (
    segment?.kind?.type !== 'Segment' ||
    segment.kind.segment.type !== 'Arc'
  ) {
    return null
  }

  // Get the point ID from the segment
  const pointId =
    which === 'start'
      ? segment.kind.segment.start
      : which === 'end'
        ? segment.kind.segment.end
        : segment.kind.segment.center

  // Look up the point object - try array index first, then search by object ID
  let point: ApiObject | undefined = objects[pointId]
  if (
    !point ||
    point.kind?.type !== 'Segment' ||
    point.kind.segment.type !== 'Point'
  ) {
    return null
  }

  // Extract coordinates from the point's position
  return [
    point.kind.segment.position.x.value,
    point.kind.segment.position.y.value,
  ]
}

/**
 * Helper to check if a point is on a line segment (within epsilon distance)
 */
function isPointOnLineSegment(
  point: Coords2d,
  segmentStart: Coords2d,
  segmentEnd: Coords2d,
  epsilon = EPSILON_POINT_ON_SEGMENT
): Coords2d | null {
  const dx = segmentEnd[0] - segmentStart[0]
  const dy = segmentEnd[1] - segmentStart[1]
  const segmentLengthSq = dx ** 2 + dy ** 2

  if (segmentLengthSq < EPSILON_PARALLEL) {
    // Segment is degenerate, i.e it's practically a point
    const distSq =
      (point[0] - segmentStart[0]) ** 2 + (point[1] - segmentStart[1]) ** 2
    if (distSq <= epsilon * epsilon) {
      return point
    }
    return null
  }

  const pointDx = point[0] - segmentStart[0]
  const pointDy = point[1] - segmentStart[1]
  const projectionParam = (pointDx * dx + pointDy * dy) / segmentLengthSq

  // Check if point projects onto the segment
  if (projectionParam < 0 || projectionParam > 1) {
    return null
  }

  // Calculate the projected point on the segment
  const projectedPoint: Coords2d = [
    segmentStart[0] + projectionParam * dx,
    segmentStart[1] + projectionParam * dy,
  ]

  // Check if the distance from point to projected point is within epsilon
  const distDx = point[0] - projectedPoint[0]
  const distDy = point[1] - projectedPoint[1]
  const distanceSq = distDx ** 2 + distDy ** 2

  if (distanceSq <= epsilon ** 2) {
    return point
  }

  return null
}

/**
 * Helper to calculate intersection point of two line segments
 */
function lineSegmentIntersection(
  line1Start: Coords2d,
  line1End: Coords2d,
  line2Start: Coords2d,
  line2End: Coords2d,
  epsilon = EPSILON_POINT_ON_SEGMENT
): Coords2d | null {
  // First check if any endpoints are on the other segment
  const line1StartOnSegment2 = isPointOnLineSegment(
    line1Start,
    line2Start,
    line2End,
    epsilon
  )
  if (line1StartOnSegment2) return line1StartOnSegment2

  const line1EndOnSegment2 = isPointOnLineSegment(
    line1End,
    line2Start,
    line2End,
    epsilon
  )
  if (line1EndOnSegment2) return line1EndOnSegment2

  const line2StartOnSegment1 = isPointOnLineSegment(
    line2Start,
    line1Start,
    line1End,
    epsilon
  )
  if (line2StartOnSegment1) return line2StartOnSegment1

  const line2EndOnSegment1 = isPointOnLineSegment(
    line2End,
    line1Start,
    line1End,
    epsilon
  )
  if (line2EndOnSegment1) return line2EndOnSegment1

  // Then check for actual line segment intersection
  const [x1, y1] = line1Start
  const [x2, y2] = line1End
  const [x3, y3] = line2Start
  const [x4, y4] = line2End

  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < EPSILON_PARALLEL) {
    // Lines are parallel
    return null
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator

  // Check if intersection is within both segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    const x = x1 + t * (x2 - x1)
    const y = y1 + t * (y2 - y1)
    return [x, y]
  }

  return null
}

/**
 * Helper to check if a point is on an arc segment (CCW from start to end)
 */
function isPointOnArc(
  point: Coords2d,
  center: Coords2d,
  start: Coords2d,
  end: Coords2d,
  epsilon = EPSILON_POINT_ON_SEGMENT
): boolean {
  // Calculate radius
  const radius = Math.sqrt(
    (start[0] - center[0]) ** 2 + (start[1] - center[1]) ** 2
  )

  // Check if point is on the circle (within epsilon)
  const distFromCenter = Math.sqrt(
    (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2
  )
  if (Math.abs(distFromCenter - radius) > epsilon) {
    return false
  }

  // Calculate angles
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])
  const pointAngle = Math.atan2(point[1] - center[1], point[0] - center[0])

  // Normalize angles to [0, 2π]
  const normalizeAngle = (angle: number): number => {
    let normalized = angle
    while (normalized < 0) normalized += 2 * Math.PI
    while (normalized >= 2 * Math.PI) normalized -= 2 * Math.PI
    return normalized
  }

  let normalizedStart = normalizeAngle(startAngle)
  let normalizedEnd = normalizeAngle(endAngle)
  let normalizedPoint = normalizeAngle(pointAngle)

  // Check if point is on the arc going CCW from start to end
  // Since arcs always travel CCW, we need to check if the point angle
  // is between start and end when going CCW
  if (normalizedStart < normalizedEnd) {
    // No wrap around
    return (
      normalizedPoint >= normalizedStart && normalizedPoint <= normalizedEnd
    )
  } else {
    // Wrap around (e.g., start at 350°, end at 10°)
    return (
      normalizedPoint >= normalizedStart || normalizedPoint <= normalizedEnd
    )
  }
}

/**
 * Helper to calculate intersection between a line segment and an arc
 */
function lineArcIntersection(
  lineStart: Coords2d,
  lineEnd: Coords2d,
  arcCenter: Coords2d,
  arcStart: Coords2d,
  arcEnd: Coords2d,
  epsilon = EPSILON_POINT_ON_SEGMENT
): Coords2d | null {
  // Calculate radius
  const radius = Math.sqrt(
    (arcStart[0] - arcCenter[0]) ** 2 + (arcStart[1] - arcCenter[1]) ** 2
  )

  // Translate line to origin (center at 0,0)
  const translatedLineStart: Coords2d = [
    lineStart[0] - arcCenter[0],
    lineStart[1] - arcCenter[1],
  ]
  const translatedLineEnd: Coords2d = [
    lineEnd[0] - arcCenter[0],
    lineEnd[1] - arcCenter[1],
  ]

  // Line equation: p = lineStart + t * (lineEnd - lineStart)
  const dx = translatedLineEnd[0] - translatedLineStart[0]
  const dy = translatedLineEnd[1] - translatedLineStart[1]

  // Circle equation: x² + y² = r²
  // Substitute line equation into circle equation
  // (x0 + t*dx)² + (y0 + t*dy)² = r²
  // Expand: x0² + 2*x0*t*dx + t²*dx² + y0² + 2*y0*t*dy + t²*dy² = r²
  // Rearrange: t²*(dx² + dy²) + 2*t*(x0*dx + y0*dy) + (x0² + y0² - r²) = 0

  const a = dx * dx + dy * dy
  const b = 2 * (translatedLineStart[0] * dx + translatedLineStart[1] * dy)
  const c =
    translatedLineStart[0] * translatedLineStart[0] +
    translatedLineStart[1] * translatedLineStart[1] -
    radius * radius

  const discriminant = b * b - 4 * a * c

  if (discriminant < 0) {
    // No intersection
    return null
  }

  if (Math.abs(a) < EPSILON_PARALLEL) {
    // Line segment is degenerate
    const distFromCenter = Math.sqrt(
      translatedLineStart[0] ** 2 + translatedLineStart[1] ** 2
    )
    if (Math.abs(distFromCenter - radius) <= epsilon) {
      // Point is on circle, check if it's on the arc
      const point: Coords2d = [lineStart[0], lineStart[1]]
      if (isPointOnArc(point, arcCenter, arcStart, arcEnd, epsilon)) {
        return point
      }
    }
    return null
  }

  const sqrtDiscriminant = Math.sqrt(discriminant)
  const t1 = (-b - sqrtDiscriminant) / (2 * a)
  const t2 = (-b + sqrtDiscriminant) / (2 * a)

  // Check both intersection points
  const candidates: Array<{ t: number; point: Coords2d }> = []
  if (t1 >= 0 && t1 <= 1) {
    const point: Coords2d = [
      lineStart[0] + t1 * (lineEnd[0] - lineStart[0]),
      lineStart[1] + t1 * (lineEnd[1] - lineStart[1]),
    ]
    candidates.push({ t: t1, point })
  }
  if (t2 >= 0 && t2 <= 1 && Math.abs(t2 - t1) > epsilon) {
    const point: Coords2d = [
      lineStart[0] + t2 * (lineEnd[0] - lineStart[0]),
      lineStart[1] + t2 * (lineEnd[1] - lineStart[1]),
    ]
    candidates.push({ t: t2, point })
  }

  // Check which candidate is on the arc
  for (const candidate of candidates) {
    if (isPointOnArc(candidate.point, arcCenter, arcStart, arcEnd, epsilon)) {
      return candidate.point
    }
  }

  return null
}

/**
 * Points is the points of a free hand line the user drew to indicate where to trim.
 * This loop through each par of point to determine if it intersects with any segment in the objects list.
 * This includes both straight segments and arcs
 * Once it finds an intersection, it returns the segment id, the coordinates of the intersection,
 * and the point index it got up to (this allows us to call this function again to find the next intersection)
 */
export function getNextTrimCoords({
  points,
  startIndex,
  objects,
}: {
  points: Array<Coords2d>
  startIndex: number
  objects: ApiObject[]
}):
  | {
      type: 'trimSpawn'
      trimSpawnSegId: number
      trimSpawnCoords: Coords2d
      nextIndex: number
    }
  | {
      type: 'noTrimSpawn'
      nextIndex: number
    } {
  // When calculating intersection for arcs, remember that arcs always travel CCW from start to end (i.e. not the shortest path)

  // Loop through polyline segments starting from startIndex
  for (let i = startIndex; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]

    // Check this polyline segment against all scene segments
    for (let segmentId = 0; segmentId < objects.length; segmentId++) {
      const obj = objects[segmentId]

      if (obj?.kind?.type !== 'Segment') {
        continue
      }

      // Handle Line segments
      // Look up point objects to get post-solve coordinates
      if (obj.kind.segment.type === 'Line') {
        const startPoint = getPositionCoordsForLine(obj, 'start', objects)
        const endPoint = getPositionCoordsForLine(obj, 'end', objects)

        if (!startPoint || !endPoint) {
          continue
        }

        const intersection = lineSegmentIntersection(
          p1,
          p2,
          startPoint,
          endPoint
        )

        if (intersection) {
          return {
            type: 'trimSpawn',
            trimSpawnSegId: obj.id,
            trimSpawnCoords: intersection,
            nextIndex: i,
          }
        }
      }

      // Handle Arc segments
      // Look up point objects to get post-solve coordinates
      if (obj.kind.segment.type === 'Arc') {
        const centerPoint = getPositionCoordsFromArc(obj, 'center', objects)
        const startPoint = getPositionCoordsFromArc(obj, 'start', objects)
        const endPoint = getPositionCoordsFromArc(obj, 'end', objects)

        if (!centerPoint || !startPoint || !endPoint) {
          continue
        }

        const intersection = lineArcIntersection(
          p1,
          p2,
          centerPoint,
          startPoint,
          endPoint
        )

        if (intersection) {
          return {
            type: 'trimSpawn',
            trimSpawnSegId: obj.id,
            trimSpawnCoords: intersection,
            nextIndex: i,
          }
        }
      }
    }
  }

  // No intersection found
  return {
    type: 'noTrimSpawn',
    nextIndex: points.length - 1,
  }
}

type TrimTerminationEnd = {
  type: 'segEndPoint'
  trimTerminationCoords: Coords2d
}

type TrimTerminationIntersection = {
  type: 'intersection'
  trimTerminationCoords: Coords2d
  intersectingSegId: number
}

type TrimTerminationCoincidentPoint = {
  type: 'coincidentPoint'
  trimTerminationCoords: Coords2d
  coincidentSegId: number
  coincidentPointId: number
}

type TrimTermination =
  | TrimTerminationEnd
  | TrimTerminationIntersection
  | TrimTerminationCoincidentPoint

/**
 * For the trim spawn segment, and the intersection point on that segment,
 * we need to travel both directions to find the "trim terminations", thas is ends of the trim spawn.
 * It can either be
 * - A end of the segment (whether it's coincident or not)
 *
 *   ========0
 * OR
 *   ========0
 *            \
 *             \
 * - It could intersect with another segment
 *            /
 *           /
 *  ========X=====
 *         /
 *        /
 * - Or the most subtle is another segment could have one of it's endpoints
 * coincident with the trim spawn segment
 *
 *  ========0=====
 *         /
 *        /
 */
export function getTrimSpawnTerminations({
  trimSpawnSegId,
  trimSpawnCoords,
  objects,
}: {
  trimSpawnSegId: number
  trimSpawnCoords: Array<Coords2d>
  objects: ApiObject[]
}):
  | {
      leftSide: TrimTermination
      rightSide: TrimTermination
    }
  | Error {
  // TODO: Implement
  return new Error('Not implemented')
}

/**
 * Based on the two trim terminations, we need to decide what kind of trim strategy to use
 * There are three possibilities:
 * - Simple trim: just delete the entire segment because neither end intersects with anything
 * - Cut tail: one end intersects with something, so we cut the segment to that point
 * - Segment split: both ends intersect with something, so we split the segment into two new segments
 */
function _TrimStrategy({
  leftSide,
  rightSide,
}: {
  leftSide: TrimTermination
  rightSide: TrimTermination
}):
  | {
      type: 'simpleTrim'
      segmentToTrimId: number
    }
  | {
      type: 'cutTail'
      segmentToTrimId: number
      segmentOrPointToMakeCoincidentTo: number
      position: Coords2d
      segmentEnd: 'start' | 'end'
    }
  | {
      type: 'segmentSplit'
      segmentId: number
      firstPosition: Coords2d
      firstSegmentOrPointToMakeCoincidentTo: number
      secondPosition: Coords2d
      secondSegmentOrPointToMakeCoincidentTo: number
    }
  | Error {
  // TODO: Implement
  return new Error('Not implemented')
}
