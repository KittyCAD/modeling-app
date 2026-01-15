import type {
  ApiObject,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'

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
export function getPositionCoordsFromArc(
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
 * @internal - exported for testing
 */
export function isPointOnLineSegment(
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
 * @internal - exported for testing
 */
export function lineSegmentIntersection(
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
 * @internal - exported for testing
 */
export function isPointOnArc(
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
 * @internal - exported for testing
 */
export function lineArcIntersection(
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
 * Helper to calculate intersection between two arcs (via circle-circle intersection)
 * Arcs always travel CCW from start to end (not the shortest path)
 * Returns the first valid intersection point found, or null if none
 */
export function arcArcIntersection(
  arc1Center: Coords2d,
  arc1Start: Coords2d,
  arc1End: Coords2d,
  arc2Center: Coords2d,
  arc2Start: Coords2d,
  arc2End: Coords2d,
  epsilon = EPSILON_POINT_ON_SEGMENT
): Coords2d | null {
  // Calculate radii
  const r1 = Math.sqrt(
    (arc1Start[0] - arc1Center[0]) ** 2 + (arc1Start[1] - arc1Center[1]) ** 2
  )
  const r2 = Math.sqrt(
    (arc2Start[0] - arc2Center[0]) ** 2 + (arc2Start[1] - arc2Center[1]) ** 2
  )

  // Distance between centers
  const dx = arc2Center[0] - arc1Center[0]
  const dy = arc2Center[1] - arc1Center[1]
  const d = Math.sqrt(dx * dx + dy * dy)

  // Check if circles intersect
  if (d > r1 + r2 + epsilon || d < Math.abs(r1 - r2) - epsilon) {
    // No intersection
    return null
  }

  // Check for degenerate cases
  if (d < EPSILON_PARALLEL) {
    // Concentric circles - no intersection (or infinite if same radius, but we treat as none)
    return null
  }

  // Calculate intersection points
  // Using the formula from: https://mathworld.wolfram.com/Circle-CircleIntersection.html
  // The intersection points lie on a line perpendicular to the line connecting centers
  // at distance a from arc1Center along the line to arc2Center

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(r1 * r1 - a * a)

  // If h is NaN or imaginary, no intersection
  if (Number.isNaN(h) || h < 0) {
    return null
  }

  // Unit vector from arc1Center to arc2Center
  const ux = dx / d
  const uy = dy / d

  // Perpendicular vector (rotated 90 degrees)
  const px = -uy
  const py = ux

  // Midpoint on the line connecting centers
  const midPoint: Coords2d = [arc1Center[0] + a * ux, arc1Center[1] + a * uy]

  // Two intersection points
  const intersection1: Coords2d = [midPoint[0] + h * px, midPoint[1] + h * py]
  const intersection2: Coords2d = [midPoint[0] - h * px, midPoint[1] - h * py]

  // Check which intersection point(s) are on both arcs
  const candidates: Coords2d[] = []

  if (
    isPointOnArc(intersection1, arc1Center, arc1Start, arc1End, epsilon) &&
    isPointOnArc(intersection1, arc2Center, arc2Start, arc2End, epsilon)
  ) {
    candidates.push(intersection1)
  }

  if (
    Math.abs(intersection1[0] - intersection2[0]) > epsilon ||
    Math.abs(intersection1[1] - intersection2[1]) > epsilon
  ) {
    // Only check second point if it's different from the first
    if (
      isPointOnArc(intersection2, arc1Center, arc1Start, arc1End, epsilon) &&
      isPointOnArc(intersection2, arc2Center, arc2Start, arc2End, epsilon)
    ) {
      candidates.push(intersection2)
    }
  }

  // Return the first valid intersection (or null if none)
  return candidates.length > 0 ? candidates[0] : null
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
            nextIndex: i, // return current index to re-check same polyline segment for additional intersections
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
            nextIndex: i, // return current index to re-check same polyline segment for additional intersections
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

type TrimTerminationTrimSpawnSegmentCoincidentWithAnotherSegmentPoint = {
  type: 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
  trimTerminationCoords: Coords2d
  intersectingSegId: number
  trimSpawnSegmentCoincidentWithAnotherSegmentPointId: number
}

type TrimTermination =
  | TrimTerminationEnd
  | TrimTerminationIntersection
  | TrimTerminationTrimSpawnSegmentCoincidentWithAnotherSegmentPoint

/**
 * Helper to project a point onto a line segment and get its parametric position
 * Returns t where t=0 at start, t=1 at end, t<0 before start, t>1 after end
 * @internal - exported for testing
 */
export function projectPointOntoSegment(
  point: Coords2d,
  segmentStart: Coords2d,
  segmentEnd: Coords2d
): number {
  const dx = segmentEnd[0] - segmentStart[0]
  const dy = segmentEnd[1] - segmentStart[1]
  const segmentLengthSq = dx * dx + dy * dy

  if (segmentLengthSq < EPSILON_PARALLEL) {
    // Segment is degenerate
    return 0
  }

  const pointDx = point[0] - segmentStart[0]
  const pointDy = point[1] - segmentStart[1]
  const t = (pointDx * dx + pointDy * dy) / segmentLengthSq

  return t
}

/**
 * Helper to calculate the parametric position of a point on an arc
 * Returns t where t=0 at start, t=1 at end, based on CCW angle
 */
function projectPointOntoArc(
  point: Coords2d,
  arcCenter: Coords2d,
  arcStart: Coords2d,
  arcEnd: Coords2d
): number {
  // Calculate angles
  const startAngle = Math.atan2(
    arcStart[1] - arcCenter[1],
    arcStart[0] - arcCenter[0]
  )
  const endAngle = Math.atan2(
    arcEnd[1] - arcCenter[1],
    arcEnd[0] - arcCenter[0]
  )
  const pointAngle = Math.atan2(
    point[1] - arcCenter[1],
    point[0] - arcCenter[0]
  )

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

  // Calculate arc length (CCW)
  let arcLength: number
  if (normalizedStart < normalizedEnd) {
    arcLength = normalizedEnd - normalizedStart
  } else {
    // Wrap around
    arcLength = 2 * Math.PI - normalizedStart + normalizedEnd
  }

  if (arcLength < EPSILON_PARALLEL) {
    // Arc is degenerate (full circle or very small)
    return 0
  }

  // Calculate point's position along arc (CCW from start)
  let pointArcLength: number
  if (normalizedStart < normalizedEnd) {
    if (
      normalizedPoint >= normalizedStart &&
      normalizedPoint <= normalizedEnd
    ) {
      pointArcLength = normalizedPoint - normalizedStart
    } else {
      // Point is not on the arc, return closest endpoint
      const distToStart = Math.min(
        Math.abs(normalizedPoint - normalizedStart),
        2 * Math.PI - Math.abs(normalizedPoint - normalizedStart)
      )
      const distToEnd = Math.min(
        Math.abs(normalizedPoint - normalizedEnd),
        2 * Math.PI - Math.abs(normalizedPoint - normalizedEnd)
      )
      return distToStart < distToEnd ? 0 : 1
    }
  } else {
    // Wrap around case
    if (
      normalizedPoint >= normalizedStart ||
      normalizedPoint <= normalizedEnd
    ) {
      if (normalizedPoint >= normalizedStart) {
        pointArcLength = normalizedPoint - normalizedStart
      } else {
        pointArcLength = 2 * Math.PI - normalizedStart + normalizedPoint
      }
    } else {
      // Point is not on the arc
      const distToStart = Math.min(
        Math.abs(normalizedPoint - normalizedStart),
        2 * Math.PI - Math.abs(normalizedPoint - normalizedStart)
      )
      const distToEnd = Math.min(
        Math.abs(normalizedPoint - normalizedEnd),
        2 * Math.PI - Math.abs(normalizedPoint - normalizedEnd)
      )
      return distToStart < distToEnd ? 0 : 1
    }
  }

  // Return parametric position
  return pointArcLength / arcLength
}

/**
 * Helper to check if a point is coincident with a segment (line or arc)
 */
function isPointCoincidentWithSegment(
  pointId: number,
  segmentId: number,
  objects: ApiObject[]
): boolean {
  // Find coincident constraints
  for (const obj of objects) {
    if (
      obj?.kind?.type === 'Constraint' &&
      obj.kind.constraint.type === 'Coincident'
    ) {
      const segments = obj.kind.constraint.segments
      if (segments.includes(pointId) && segments.includes(segmentId)) {
        return true
      }
    }
  }
  return false
}

/**
 * Helper to calculate perpendicular distance from a point to a line segment
 * @internal - exported for testing
 */
export function perpendicularDistanceToSegment(
  point: Coords2d,
  segmentStart: Coords2d,
  segmentEnd: Coords2d
): number {
  const dx = segmentEnd[0] - segmentStart[0]
  const dy = segmentEnd[1] - segmentStart[1]
  const segmentLengthSq = dx * dx + dy * dy

  if (segmentLengthSq < EPSILON_PARALLEL) {
    // Segment is degenerate, return distance to point
    const distDx = point[0] - segmentStart[0]
    const distDy = point[1] - segmentStart[1]
    return Math.sqrt(distDx * distDx + distDy * distDy)
  }

  // Vector from segment start to point
  const pointDx = point[0] - segmentStart[0]
  const pointDy = point[1] - segmentStart[1]

  // Project point onto segment
  const t = (pointDx * dx + pointDy * dy) / segmentLengthSq

  // Clamp t to [0, 1] to get closest point on segment
  const clampedT = Math.max(0, Math.min(1, t))
  const closestPoint: Coords2d = [
    segmentStart[0] + clampedT * dx,
    segmentStart[1] + clampedT * dy,
  ]

  // Calculate distance
  const distDx = point[0] - closestPoint[0]
  const distDy = point[1] - closestPoint[1]
  return Math.sqrt(distDx * distDx + distDy * distDy)
}

/**
 * For the trim spawn segment and the intersection point on that segment,
 * finds the "trim terminations" in both directions (left and right from the intersection point).
 * A termination is the point where trimming should stop in each direction.
 *
 * The function searches for candidates in each direction and selects the closest one,
 * with the following priority when distances are equal: coincident > intersection > endpoint.
 *
 * ## segEndPoint: The segment's own endpoint
 *
 *   ========0
 * OR
 *   ========0
 *            \
 *             \
 *
 *  Returns this when:
 *  - No other candidates are found between the intersection point and the segment end
 *  - An intersection is found at the segment's own endpoint (even if due to numerical precision)
 *  - An intersection is found at another segment's endpoint (without a coincident constraint)
 *  - The closest candidate is the segment's own endpoint
 *
 * ## intersection: Intersection with another segment's body
 *            /
 *           /
 *  ========X=====
 *         /
 *        /
 *
 *  Returns this when:
 *  - A geometric intersection is found with another segment's body (not at an endpoint)
 *  - The intersection is not at our own segment's endpoint
 *  - The intersection is not at the other segment's endpoint (which would be segEndPoint)
 *
 * ## trimSpawnSegmentCoincidentWithAnotherSegmentPoint: Another segment's endpoint coincident with our segment
 *
 *  ========0=====
 *         /
 *        /
 *
 *  Returns this when:
 *  - Another segment's endpoint has a coincident constraint with our trim spawn segment
 *  - The endpoint's perpendicular distance to our segment is within epsilon
 *  - The endpoint is geometrically on our segment (between start and end)
 *  - This takes priority over intersections when at the same location
 *
 * ## Fallback
 *  If no candidates are found in a direction, defaults to "segEndPoint" and logs an error to the console.
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
  // Find the trim spawn segment
  const trimSpawnSeg = objects.find((obj) => obj.id === trimSpawnSegId)
  if (!trimSpawnSeg || trimSpawnSeg.kind?.type !== 'Segment') {
    return new Error(`Trim spawn segment ${trimSpawnSegId} not found`)
  }

  // Get segment coordinates
  let segmentStart: Coords2d | null = null
  let segmentEnd: Coords2d | null = null
  let segmentCenter: Coords2d | null = null

  if (trimSpawnSeg.kind.segment.type === 'Line') {
    segmentStart = getPositionCoordsForLine(trimSpawnSeg, 'start', objects)
    segmentEnd = getPositionCoordsForLine(trimSpawnSeg, 'end', objects)
  } else if (trimSpawnSeg.kind.segment.type === 'Arc') {
    segmentStart = getPositionCoordsFromArc(trimSpawnSeg, 'start', objects)
    segmentEnd = getPositionCoordsFromArc(trimSpawnSeg, 'end', objects)
    segmentCenter = getPositionCoordsFromArc(trimSpawnSeg, 'center', objects)
  } else {
    return new Error(
      `Trim spawn segment ${trimSpawnSegId} is not a Line or Arc`
    )
  }

  if (!segmentStart || !segmentEnd) {
    return new Error(
      `Could not get coordinates for trim spawn segment ${trimSpawnSegId}`
    )
  }

  // Find intersection point between polyline and trim spawn segment
  // trimSpawnCoords is a polyline, so we check each segment
  // We need to find ALL intersections and use a consistent one to avoid
  // different results for different trim lines in the same area
  const allIntersections: Array<{
    point: Coords2d
    segmentIndex: number
  }> = []

  for (let i = 0; i < trimSpawnCoords.length - 1; i++) {
    const p1 = trimSpawnCoords[i]
    const p2 = trimSpawnCoords[i + 1]

    if (trimSpawnSeg.kind.segment.type === 'Line') {
      const intersection = lineSegmentIntersection(
        p1,
        p2,
        segmentStart,
        segmentEnd
      )
      if (intersection) {
        allIntersections.push({ point: intersection, segmentIndex: i })
      }
    } else if (trimSpawnSeg.kind.segment.type === 'Arc' && segmentCenter) {
      const intersection = lineArcIntersection(
        p1,
        p2,
        segmentCenter,
        segmentStart,
        segmentEnd
      )
      if (intersection) {
        allIntersections.push({ point: intersection, segmentIndex: i })
      }
    }
  }

  // Use the intersection that's closest to the middle of the polyline
  // This ensures consistent results regardless of which segment intersects first
  let intersectionPoint: Coords2d | null = null
  if (allIntersections.length > 0) {
    // Find the middle of the polyline
    const midIndex = Math.floor((trimSpawnCoords.length - 1) / 2)
    const midPoint = trimSpawnCoords[midIndex]

    // Find the intersection closest to the middle
    let minDist = Infinity
    for (const intersection of allIntersections) {
      const dist = Math.sqrt(
        (intersection.point[0] - midPoint[0]) ** 2 +
          (intersection.point[1] - midPoint[1]) ** 2
      )
      if (dist < minDist) {
        minDist = dist
        intersectionPoint = intersection.point
      }
    }

    // Fallback: if no intersection is close to middle, use the first one
    if (!intersectionPoint) {
      intersectionPoint = allIntersections[0].point
    }
  }

  if (!intersectionPoint) {
    return new Error(
      'Could not find intersection point between polyline and trim spawn segment'
    )
  }

  // Project intersection point onto segment to get parametric position
  let intersectionT: number
  if (trimSpawnSeg.kind.segment.type === 'Line') {
    intersectionT = projectPointOntoSegment(
      intersectionPoint,
      segmentStart,
      segmentEnd
    )
  } else if (trimSpawnSeg.kind.segment.type === 'Arc' && segmentCenter) {
    intersectionT = projectPointOntoArc(
      intersectionPoint,
      segmentCenter,
      segmentStart,
      segmentEnd
    )
  } else {
    return new Error('Invalid segment type for trim spawn')
  }

  // Find terminations on both sides
  const leftTermination = findTerminationInDirection(
    trimSpawnSeg,
    intersectionPoint,
    intersectionT,
    'left',
    objects,
    segmentStart,
    segmentEnd,
    segmentCenter
  )

  const rightTermination = findTerminationInDirection(
    trimSpawnSeg,
    intersectionPoint,
    intersectionT,
    'right',
    objects,
    segmentStart,
    segmentEnd,
    segmentCenter
  )

  if (leftTermination instanceof Error) {
    return leftTermination
  }
  if (rightTermination instanceof Error) {
    return rightTermination
  }

  return {
    leftSide: leftTermination,
    rightSide: rightTermination,
  }
}

/**
 * Helper to find termination in a given direction from the intersection point
 */
function findTerminationInDirection(
  trimSpawnSeg: ApiObject,
  intersectionPoint: Coords2d,
  intersectionT: number,
  direction: 'left' | 'right',
  objects: ApiObject[],
  segmentStart: Coords2d,
  segmentEnd: Coords2d,
  segmentCenter: Coords2d | null
): TrimTermination | Error {
  if (trimSpawnSeg.kind.type !== 'Segment') {
    return new Error('Trim spawn segment is not a segment')
  }

  // Collect all candidate points: intersections, coincident points, and endpoints
  const candidates: Array<{
    t: number
    point: Coords2d
    type: 'intersection' | 'coincident' | 'endpoint'
    segmentId?: number
    pointId?: number
  }> = []

  // Add segment endpoints
  if (trimSpawnSeg.kind.segment.type === 'Line') {
    const startT = 0
    const endT = 1
    candidates.push({
      t: startT,
      point: segmentStart,
      type: 'endpoint',
      pointId: trimSpawnSeg.kind.segment.start,
    })
    candidates.push({
      t: endT,
      point: segmentEnd,
      type: 'endpoint',
      pointId: trimSpawnSeg.kind.segment.end,
    })
  } else if (trimSpawnSeg.kind.segment.type === 'Arc') {
    // For arcs, endpoints are at t=0 and t=1 conceptually
    candidates.push({
      t: 0,
      point: segmentStart,
      type: 'endpoint',
      pointId: trimSpawnSeg.kind.segment.start,
    })
    candidates.push({
      t: 1,
      point: segmentEnd,
      type: 'endpoint',
      pointId: trimSpawnSeg.kind.segment.end,
    })
  }

  // Find intersections with other segments
  for (let otherSegId = 0; otherSegId < objects.length; otherSegId++) {
    const otherSeg = objects[otherSegId]
    if (
      !otherSeg ||
      otherSeg.id === trimSpawnSeg.id ||
      otherSeg.kind?.type !== 'Segment'
    ) {
      continue
    }

    if (otherSeg.kind.segment.type === 'Line') {
      const otherStart = getPositionCoordsForLine(otherSeg, 'start', objects)
      const otherEnd = getPositionCoordsForLine(otherSeg, 'end', objects)
      if (!otherStart || !otherEnd) continue

      if (trimSpawnSeg.kind.segment.type === 'Line') {
        const intersection = lineSegmentIntersection(
          segmentStart,
          segmentEnd,
          otherStart,
          otherEnd
        )
        if (intersection) {
          const t = projectPointOntoSegment(
            intersection,
            segmentStart,
            segmentEnd
          )
          candidates.push({
            t,
            point: intersection,
            type: 'intersection',
            segmentId: otherSeg.id,
          })
        }
      } else if (trimSpawnSeg.kind.segment.type === 'Arc' && segmentCenter) {
        const intersection = lineArcIntersection(
          otherStart,
          otherEnd,
          segmentCenter,
          segmentStart,
          segmentEnd
        )
        if (intersection) {
          const t = projectPointOntoArc(
            intersection,
            segmentCenter,
            segmentStart,
            segmentEnd
          )
          candidates.push({
            t,
            point: intersection,
            type: 'intersection',
            segmentId: otherSeg.id,
          })
        }
      }
    } else if (otherSeg.kind.segment.type === 'Arc') {
      const otherStart = getPositionCoordsFromArc(otherSeg, 'start', objects)
      const otherEnd = getPositionCoordsFromArc(otherSeg, 'end', objects)
      const otherCenter = getPositionCoordsFromArc(otherSeg, 'center', objects)
      if (!otherStart || !otherEnd || !otherCenter) continue

      if (trimSpawnSeg.kind.segment.type === 'Line') {
        const intersection = lineArcIntersection(
          segmentStart,
          segmentEnd,
          otherCenter,
          otherStart,
          otherEnd
        )
        if (intersection) {
          const t = projectPointOntoSegment(
            intersection,
            segmentStart,
            segmentEnd
          )
          candidates.push({
            t,
            point: intersection,
            type: 'intersection',
            segmentId: otherSeg.id,
          })
        }
      } else if (trimSpawnSeg.kind.segment.type === 'Arc' && segmentCenter) {
        const intersection = arcArcIntersection(
          segmentCenter,
          segmentStart,
          segmentEnd,
          otherCenter,
          otherStart,
          otherEnd
        )
        if (intersection) {
          const t = projectPointOntoArc(
            intersection,
            segmentCenter,
            segmentStart,
            segmentEnd
          )
          candidates.push({
            t,
            point: intersection,
            type: 'intersection',
            segmentId: otherSeg.id,
          })
        }
      }
    }

    // Check for coincident points (check BEFORE intersections for priority)
    // Check Line segment endpoints
    if (otherSeg.kind.segment.type === 'Line') {
      const otherStartId = otherSeg.kind.segment.start
      const otherEndId = otherSeg.kind.segment.end

      // Check if other segment's endpoints are coincident with trim spawn segment
      if (
        isPointCoincidentWithSegment(otherStartId, trimSpawnSeg.id, objects)
      ) {
        const otherStart = getPositionCoordsForLine(otherSeg, 'start', objects)
        if (otherStart) {
          let t: number = 0
          let isOnSegment = false

          if (trimSpawnSeg.kind.segment.type === 'Line') {
            t = projectPointOntoSegment(otherStart, segmentStart, segmentEnd)
            // Check if point is on the segment (between start and end)
            isOnSegment =
              t >= 0 &&
              t <= 1 &&
              perpendicularDistanceToSegment(
                otherStart,
                segmentStart,
                segmentEnd
              ) <= EPSILON_POINT_ON_SEGMENT
          } else if (
            trimSpawnSeg.kind.segment.type === 'Arc' &&
            segmentCenter
          ) {
            t = projectPointOntoArc(
              otherStart,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
            // Check if point is on the arc
            isOnSegment = isPointOnArc(
              otherStart,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
          }

          // Only add if point is on the segment and between intersection and segment end
          if (isOnSegment) {
            candidates.push({
              t,
              point: otherStart,
              type: 'coincident',
              segmentId: otherSeg.id,
              pointId: otherStartId,
            })
          }
        }
      }

      if (isPointCoincidentWithSegment(otherEndId, trimSpawnSeg.id, objects)) {
        const otherEnd = getPositionCoordsForLine(otherSeg, 'end', objects)
        if (otherEnd) {
          let t: number = 0
          let isOnSegment = false

          if (trimSpawnSeg.kind.segment.type === 'Line') {
            t = projectPointOntoSegment(otherEnd, segmentStart, segmentEnd)
            isOnSegment =
              t >= 0 &&
              t <= 1 &&
              perpendicularDistanceToSegment(
                otherEnd,
                segmentStart,
                segmentEnd
              ) <= EPSILON_POINT_ON_SEGMENT
          } else if (
            trimSpawnSeg.kind.segment.type === 'Arc' &&
            segmentCenter
          ) {
            t = projectPointOntoArc(
              otherEnd,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
            isOnSegment = isPointOnArc(
              otherEnd,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
          }

          if (isOnSegment) {
            candidates.push({
              t,
              point: otherEnd,
              type: 'coincident',
              segmentId: otherSeg.id,
              pointId: otherEndId,
            })
          }
        }
      }
    }

    // Check Arc segment endpoints
    if (otherSeg.kind.segment.type === 'Arc') {
      const otherStartId = otherSeg.kind.segment.start
      const otherEndId = otherSeg.kind.segment.end

      if (
        isPointCoincidentWithSegment(otherStartId, trimSpawnSeg.id, objects)
      ) {
        const otherStart = getPositionCoordsFromArc(otherSeg, 'start', objects)
        if (otherStart) {
          let t: number = 0
          let isOnSegment = false

          if (trimSpawnSeg.kind.segment.type === 'Line') {
            t = projectPointOntoSegment(otherStart, segmentStart, segmentEnd)
            isOnSegment =
              t >= 0 &&
              t <= 1 &&
              perpendicularDistanceToSegment(
                otherStart,
                segmentStart,
                segmentEnd
              ) <= EPSILON_POINT_ON_SEGMENT
          } else if (
            trimSpawnSeg.kind.segment.type === 'Arc' &&
            segmentCenter
          ) {
            t = projectPointOntoArc(
              otherStart,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
            isOnSegment = isPointOnArc(
              otherStart,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
          }

          if (isOnSegment) {
            candidates.push({
              t,
              point: otherStart,
              type: 'coincident',
              segmentId: otherSeg.id,
              pointId: otherStartId,
            })
          }
        }
      }

      if (isPointCoincidentWithSegment(otherEndId, trimSpawnSeg.id, objects)) {
        const otherEnd = getPositionCoordsFromArc(otherSeg, 'end', objects)
        if (otherEnd) {
          let t: number = 0
          let isOnSegment = false

          if (trimSpawnSeg.kind.segment.type === 'Line') {
            t = projectPointOntoSegment(otherEnd, segmentStart, segmentEnd)
            isOnSegment =
              t >= 0 &&
              t <= 1 &&
              perpendicularDistanceToSegment(
                otherEnd,
                segmentStart,
                segmentEnd
              ) <= EPSILON_POINT_ON_SEGMENT
          } else if (
            trimSpawnSeg.kind.segment.type === 'Arc' &&
            segmentCenter
          ) {
            t = projectPointOntoArc(
              otherEnd,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
            isOnSegment = isPointOnArc(
              otherEnd,
              segmentCenter,
              segmentStart,
              segmentEnd
            )
          }

          if (isOnSegment) {
            candidates.push({
              t,
              point: otherEnd,
              type: 'coincident',
              segmentId: otherSeg.id,
              pointId: otherEndId,
            })
          }
        }
      }
    }
  }

  // Filter candidates to exclude the intersection point itself and those on the wrong side
  // Use a slightly larger epsilon to account for numerical precision variations
  // when different trim line segments intersect at slightly different points
  const intersectionEpsilon = EPSILON_POINT_ON_SEGMENT * 10 // 0.0001mm
  const filteredCandidates = candidates.filter((candidate) => {
    const distFromIntersection = Math.abs(candidate.t - intersectionT)
    if (distFromIntersection < intersectionEpsilon) {
      return false // Too close to intersection point
    }

    if (direction === 'left') {
      return candidate.t < intersectionT
    } else {
      return candidate.t > intersectionT
    }
  })

  // Check if any intersection is at an endpoint with coincident constraint
  // According to docstring: "If it find one right at the end because of a numerical precision issue,
  // if the end of that segment has a coincident with the end of our trim spawn segment its still considered 'segEndPoint'"
  const endpointT = direction === 'left' ? 0 : 1

  // Sort candidates by distance from intersection (closest first)
  // When distances are equal, prioritize: coincident > intersection > endpoint
  // This ensures that constraint-based terminations (coincident) are preferred over
  // geometric intersections when they occur at the same location
  filteredCandidates.sort((a, b) => {
    const distA = Math.abs(a.t - intersectionT)
    const distB = Math.abs(b.t - intersectionT)
    const distDiff = distA - distB
    if (Math.abs(distDiff) > EPSILON_POINT_ON_SEGMENT) {
      return distDiff
    }
    // Distances are effectively equal - prioritize by type
    const typePriority = (type: string) => {
      if (type === 'coincident') return 0
      if (type === 'intersection') return 1
      return 2 // endpoint
    }
    return typePriority(a.type) - typePriority(b.type)
  })

  // Find the first valid termination
  const closestCandidate = filteredCandidates[0]

  // Check if the closest candidate is an intersection that is actually another segment's endpoint
  // According to test case: if another segment's endpoint is on our segment (even without coincident constraint),
  // we should return segEndPoint, not intersection
  if (closestCandidate && closestCandidate.type === 'intersection') {
    const intersectingSeg = objects.find(
      (obj) => obj.id === closestCandidate.segmentId
    )

    if (intersectingSeg && intersectingSeg.kind?.type === 'Segment') {
      let isOtherSegEndpoint = false
      // Use a larger epsilon for checking if intersection is at another segment's endpoint
      // because of numerical precision issues in geometric calculations
      const endpointEpsilon = EPSILON_POINT_ON_SEGMENT * 1000 // 0.001mm

      if (intersectingSeg.kind.segment.type === 'Line') {
        const otherStart = getPositionCoordsForLine(
          intersectingSeg,
          'start',
          objects
        )
        const otherEnd = getPositionCoordsForLine(
          intersectingSeg,
          'end',
          objects
        )
        if (otherStart && otherEnd) {
          const distToStart = Math.sqrt(
            (closestCandidate.point[0] - otherStart[0]) ** 2 +
              (closestCandidate.point[1] - otherStart[1]) ** 2
          )
          const distToEnd = Math.sqrt(
            (closestCandidate.point[0] - otherEnd[0]) ** 2 +
              (closestCandidate.point[1] - otherEnd[1]) ** 2
          )
          isOtherSegEndpoint =
            distToStart < endpointEpsilon || distToEnd < endpointEpsilon
        }
      } else if (intersectingSeg.kind.segment.type === 'Arc') {
        const otherStart = getPositionCoordsFromArc(
          intersectingSeg,
          'start',
          objects
        )
        const otherEnd = getPositionCoordsFromArc(
          intersectingSeg,
          'end',
          objects
        )
        if (otherStart && otherEnd) {
          const distToStart = Math.sqrt(
            (closestCandidate.point[0] - otherStart[0]) ** 2 +
              (closestCandidate.point[1] - otherStart[1]) ** 2
          )
          const distToEnd = Math.sqrt(
            (closestCandidate.point[0] - otherEnd[0]) ** 2 +
              (closestCandidate.point[1] - otherEnd[1]) ** 2
          )
          isOtherSegEndpoint =
            distToStart < endpointEpsilon || distToEnd < endpointEpsilon
        }
      }

      // If the intersection point is another segment's endpoint (even without coincident constraint),
      // return segEndPoint instead of intersection
      // This handles the case where another segment's endpoint is on our segment but there's no constraint
      if (isOtherSegEndpoint) {
        const endpoint = direction === 'left' ? segmentStart : segmentEnd
        return {
          type: 'segEndPoint',
          trimTerminationCoords: endpoint,
        }
      }
    }

    // Also check if intersection is at our arc's endpoint
    // According to docstring: if intersection is at endpoint, it should be segEndPoint
    const endpoint = direction === 'left' ? segmentStart : segmentEnd
    const distToEndpointParam = Math.abs(closestCandidate.t - endpointT)
    const distToEndpointCoords = Math.sqrt(
      (closestCandidate.point[0] - endpoint[0]) ** 2 +
        (closestCandidate.point[1] - endpoint[1]) ** 2
    )

    const isAtEndpoint =
      distToEndpointParam < EPSILON_POINT_ON_SEGMENT ||
      distToEndpointCoords < EPSILON_POINT_ON_SEGMENT

    if (isAtEndpoint) {
      // Intersection is at our endpoint -> segEndPoint
      return {
        type: 'segEndPoint',
        trimTerminationCoords: endpoint,
      }
    }
  }

  if (!closestCandidate) {
    // No termination found, default to segment endpoint
    const endpoint = direction === 'left' ? segmentStart : segmentEnd
    console.error(
      `No termination found for ${direction} side, defaulting to segment endpoint`
    )
    return {
      type: 'segEndPoint',
      trimTerminationCoords: endpoint,
    }
  }

  // Before returning, check if the closest candidate is an intersection at an endpoint
  // According to docstring: if intersection is at endpoint, it should be segEndPoint
  const endpointTForReturn = direction === 'left' ? 0 : 1
  if (closestCandidate.type === 'intersection') {
    const distToEndpoint = Math.abs(closestCandidate.t - endpointTForReturn)
    if (distToEndpoint < EPSILON_POINT_ON_SEGMENT) {
      // Intersection is at endpoint - check if there's a coincident constraint
      // or if it's just a numerical precision issue
      const endpoint = direction === 'left' ? segmentStart : segmentEnd
      return {
        type: 'segEndPoint',
        trimTerminationCoords: endpoint,
      }
    }
  }

  // Check if the closest candidate is an endpoint at the trim spawn segment's endpoint
  // This handles the case where endpoints are on the segment but there's no constraint
  const endpoint = direction === 'left' ? segmentStart : segmentEnd
  if (closestCandidate.type === 'endpoint') {
    const distToEndpoint = Math.abs(closestCandidate.t - endpointTForReturn)
    if (distToEndpoint < EPSILON_POINT_ON_SEGMENT) {
      // This is our own endpoint, return it
      return {
        type: 'segEndPoint',
        trimTerminationCoords: endpoint,
      }
    }
  }

  // Return appropriate termination type
  if (closestCandidate.type === 'coincident') {
    // Even if at endpoint, return coincident type because it's a constraint-based termination
    // and might need to be migrated in the case of a segment split
    return {
      type: 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint',
      trimTerminationCoords: closestCandidate.point,
      intersectingSegId: closestCandidate.segmentId!,
      trimSpawnSegmentCoincidentWithAnotherSegmentPointId:
        closestCandidate.pointId!,
    }
  } else if (closestCandidate.type === 'intersection') {
    return {
      type: 'intersection',
      trimTerminationCoords: closestCandidate.point,
      intersectingSegId: closestCandidate.segmentId!,
    }
  } else {
    // endpoint
    return {
      type: 'segEndPoint',
      trimTerminationCoords: closestCandidate.point,
    }
  }
}

/**
 * Creates the onAreaSelectEnd callback for trim operations.
 * Handles the trim flow by processing trim points and executing trim strategies.
 *
 * @param getContextData - Function to get current context (sceneGraphDelta, sketchId, rustContext)
 * @param onNewSketchOutcome - Callback when a new sketch outcome is available
 */
export function createOnAreaSelectEndCallback({
  getContextData,
  onNewSketchOutcome,
}: {
  getContextData: () => {
    sceneGraphDelta?: SceneGraphDelta
    sketchId: number
    rustContext: RustContext
  }
  onNewSketchOutcome: (outcome: {
    kclSource: { text: string }
    sceneGraphDelta: {
      new_graph: { objects: ApiObject[] }
      new_objects: number[]
      invalidates_ids: boolean
    }
  }) => void
}): (points: Coords2d[]) => Promise<void> {
  return async (points: Coords2d[]) => {
    try {
      const contextData = getContextData()
      const { sceneGraphDelta, sketchId, rustContext } = contextData

      if (!sceneGraphDelta) {
        console.error('[TRIM] ERROR: No sceneGraphDelta available!')
        return
      }

      // Use Rust WASM execute_trim which runs the full loop internally
      const settings = await jsAppSettings(rustContext.settingsActor)
      // console.log(JSON.stringify(points))

      const result = await rustContext.executeTrim(
        0, // version
        sketchId,
        points,
        settings
      )

      // If no trim operations were performed (trim line doesn't intersect any segments),
      // return early and do nothing. This is not an error - it's a normal no-op case.
      if (!result.operationsPerformed) {
        return
      }

      // Send the result
      onNewSketchOutcome({
        kclSource: result.kclSource,
        sceneGraphDelta: result.sceneGraphDelta,
      })
    } catch (error) {
      console.error('[TRIM] Exception in onAreaSelectEnd:', error)
    }
  }
}
