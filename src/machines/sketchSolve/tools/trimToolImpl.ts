import type {
  ApiObject,
  SegmentCtor,
  ApiPoint2d,
  Expr,
  ExistingSegmentCtor,
  ApiConstraint,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { isArray, roundOff } from '@src/lib/utils'

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

type SimpleTrimOperation = {
  type: 'simpleTrim'
  segmentToTrimId: number
}

type EditSegmentOperation = {
  type: 'editSegment'
  segmentId: number
  ctor: Extract<SegmentCtor, { type: 'Line' | 'Arc' }>
  endpointChanged: 'start' | 'end'
}

type AddCoincidentConstraintOperation = {
  type: 'addCoincidentConstraint'
  segmentId: number
  endpointChanged: 'start' | 'end'
  segmentOrPointToMakeCoincidentTo: number
  intersectingEndpointPointId?: number
}

type DeleteConstraintsOperation = {
  type: 'deleteConstraints'
  constraintIds: Array<number>
}

type ConstraintToMigrate = {
  constraintId: number // The constraint to delete
  otherEntityId: number // The other point or segment in the constraint
  isPointPoint: boolean // true if otherEntityId is a point, false if it's a segment
  attachToEndpoint: 'start' | 'end' | 'segment' // Which endpoint of new segment to attach to, or 'segment' to replace old segment with new segment
}

type SplitSegmentOperation = {
  type: 'splitSegment'
  segmentId: number
  leftTrimCoords: Coords2d
  rightTrimCoords: Coords2d
  originalEndCoords: Coords2d
  leftSide: TrimTermination
  rightSide: TrimTermination
  leftSideCoincidentData: {
    intersectingSegId: number
    intersectingEndpointPointId?: number
    existingPointSegmentConstraintId?: number
  }
  rightSideCoincidentData: {
    intersectingSegId: number
    intersectingEndpointPointId?: number
    existingPointSegmentConstraintId?: number
  }
  constraintsToMigrate: ConstraintToMigrate[] // All constraints that move to new segment
  constraintsToDelete: number[] // Constraints to delete (including migrated ones)
}

type TrimOperation =
  | SimpleTrimOperation
  | EditSegmentOperation
  | AddCoincidentConstraintOperation
  | SplitSegmentOperation
  | DeleteConstraintsOperation

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
 * Based on the two trim terminations, we need to decide what kind of trim strategy to use
 * There are three possibilities:
 * - Simple trim: just delete the entire segment because neither end intersects with anything
 * - Cut tail: one end intersects with something, so we cut the segment to that point
 * - Segment split: both ends intersect with something, so we split the segment into two new segments
 */
export function trimStrategy({
  trimSpawnId,
  trimSpawnSegment,
  leftSide,
  rightSide,
  objects,
}: {
  objects: ApiObject[]
  trimSpawnId: number
  trimSpawnSegment: ApiObject
  leftSide: TrimTermination
  rightSide: TrimTermination
}): TrimOperation[] | Error {
  if (leftSide.type === 'segEndPoint' && rightSide.type === 'segEndPoint') {
    return [
      {
        type: 'simpleTrim',
        segmentToTrimId: trimSpawnId,
      },
    ]
  }
  const isIntersectOrCoincident = (side: TrimTermination) =>
    side.type === 'intersection' ||
    side.type === 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
  const leftSideNeedsTailCut =
    isIntersectOrCoincident(leftSide) && !isIntersectOrCoincident(rightSide)
  const rightSideNeedsTailCut =
    isIntersectOrCoincident(rightSide) && !isIntersectOrCoincident(leftSide)

  if (trimSpawnSegment.kind?.type !== 'Segment') {
    return new Error('Trim spawn segment is not a segment')
  }
  if (
    trimSpawnSegment.kind.segment.type !== 'Line' &&
    trimSpawnSegment.kind.segment.type !== 'Arc'
  ) {
    return new Error('Trim spawn segment is not a Line or Arc')
  }
  if (
    trimSpawnSegment.kind.segment.ctor.type !== 'Line' &&
    trimSpawnSegment.kind.segment.ctor.type !== 'Arc'
  ) {
    return new Error('Trim spawn segment ctor is not a Line or Arc')
  }

  // Extract units from the existing ctor's start point
  // Both Line and Arc ctors have start points with Expr that has units
  const startX = trimSpawnSegment.kind.segment.ctor.start.x
  const units =
    startX.type === 'Var' || startX.type === 'Number' ? startX.units : 'Mm'

  // Helper to convert Coords2d to ApiPoint2d with units from ctor
  const coordsToApiPoint = (coords: Coords2d): ApiPoint2d<Expr> => ({
    x: { type: 'Var', value: roundOff(coords[0], 2), units },
    y: { type: 'Var', value: roundOff(coords[1], 2), units },
  })

  // Helper to find an existing point-segment coincident between the trim spawn
  // segment and the intersecting segment, and return the constraint id and the
  // intersecting segment endpoint id that participates in that constraint.
  const findExistingPointSegmentCoincident = (
    trimSegId: number,
    intersectingSegId: number
  ): {
    existingPointSegmentConstraintId?: number
    intersectingEndpointPointId?: number
  } => {
    // If the intersecting id itself is a point, try a fast lookup using it directly.
    const lookupByPointId = (pointId: number) => {
      for (const obj of objects) {
        if (
          obj?.kind?.type === 'Constraint' &&
          obj.kind.constraint.type === 'Coincident'
        ) {
          const segments = obj.kind.constraint.segments
          const involvesTrimSeg =
            segments.includes(trimSegId) || segments.includes(pointId)
          const involvesPoint = segments.includes(pointId)
          if (involvesTrimSeg && involvesPoint) {
            return {
              existingPointSegmentConstraintId: obj.id,
              intersectingEndpointPointId: pointId,
            }
          }
        }
      }
      return undefined
    }

    // Collect trim endpoints so constraints that reference endpoints directly are caught.
    const trimSeg = objects.find(
      (obj) => obj.id === trimSegId && obj.kind?.type === 'Segment'
    )
    const trimEndpointIds: number[] = []
    if (trimSeg?.kind?.type === 'Segment') {
      if (trimSeg.kind.segment.type === 'Line') {
        trimEndpointIds.push(
          trimSeg.kind.segment.start,
          trimSeg.kind.segment.end
        )
      } else if (trimSeg.kind.segment.type === 'Arc') {
        trimEndpointIds.push(
          trimSeg.kind.segment.start,
          trimSeg.kind.segment.end
        )
      }
    }

    const intersectingObj = objects.find((obj) => obj.id === intersectingSegId)
    if (!intersectingObj) return {}

    if (
      intersectingObj.kind?.type === 'Segment' &&
      intersectingObj.kind.segment.type === 'Point'
    ) {
      const found = lookupByPointId(intersectingSegId)
      if (found) return found
    }

    const intersectingEndpointIds: number[] = []
    if (intersectingObj.kind?.type === 'Segment') {
      if (intersectingObj.kind.segment.type === 'Line') {
        intersectingEndpointIds.push(
          intersectingObj.kind.segment.start,
          intersectingObj.kind.segment.end
        )
      } else if (intersectingObj.kind.segment.type === 'Arc') {
        intersectingEndpointIds.push(
          intersectingObj.kind.segment.start,
          intersectingObj.kind.segment.end
        )
      }
    }
    // Also include the provided intersectingSegId itself (it might already be a point id).
    intersectingEndpointIds.push(intersectingSegId)

    for (const obj of objects) {
      if (
        obj?.kind?.type === 'Constraint' &&
        obj.kind.constraint.type === 'Coincident'
      ) {
        const segments = obj.kind.constraint.segments
        const involvesTrimSeg =
          segments.includes(trimSegId) ||
          trimEndpointIds.some((id) => segments.includes(id))
        if (!involvesTrimSeg) continue
        const endpointId = intersectingEndpointIds.find((id) =>
          segments.includes(id)
        )
        if (endpointId !== undefined) {
          return {
            existingPointSegmentConstraintId: obj.id,
            intersectingEndpointPointId: endpointId,
          }
        }
      }
    }

    return {}
  }

  // Helper to find all point-point coincident constraints on a given endpoint
  // These need to be deleted when the endpoint is moved during a cutTail operation
  const findPointPointCoincidentConstraints = (
    endpointPointId: number
  ): number[] => {
    const constraintIds: number[] = []
    for (const obj of objects) {
      if (
        obj?.kind?.type === 'Constraint' &&
        obj.kind.constraint.type === 'Coincident'
      ) {
        const constraintSegments = obj.kind.constraint.segments
        // Only consider constraints that involve the endpoint
        if (!constraintSegments.includes(endpointPointId)) {
          continue
        }

        // Check if this is a point-point constraint (both segments are points)
        const isPointPointConstraint = constraintSegments.every((segId) => {
          const segObj = objects[segId]
          return (
            segObj?.kind?.type === 'Segment' &&
            segObj.kind.segment.type === 'Point'
          )
        })

        // Only collect point-point constraints, not point-segment constraints
        if (isPointPointConstraint) {
          constraintIds.push(obj.id)
        }
      }
    }
    return constraintIds
  }

  // Helper to find all point-segment coincident constraints on a given endpoint
  // These need to be moved to the new segment's end during a split trim operation
  const findPointSegmentCoincidentConstraints = (
    endpointPointId: number
  ): Array<{ constraintId: number; segmentOrPointId: number }> => {
    const constraints: Array<{
      constraintId: number
      segmentOrPointId: number
    }> = []
    for (const obj of objects) {
      if (
        obj?.kind?.type === 'Constraint' &&
        obj.kind.constraint.type === 'Coincident'
      ) {
        const constraintSegments = obj.kind.constraint.segments
        // Only consider constraints that involve the endpoint
        if (!constraintSegments.includes(endpointPointId)) {
          continue
        }

        // Check if this is a point-segment constraint (one is a point, one is a segment)
        const otherSegmentId = constraintSegments.find(
          (segId) => segId !== endpointPointId
        )
        if (otherSegmentId === undefined) {
          continue
        }

        const otherSegObj = objects[otherSegmentId]
        const isPointSegmentConstraint =
          otherSegObj?.kind?.type === 'Segment' &&
          otherSegObj.kind.segment.type !== 'Point'

        // Only collect point-segment constraints, not point-point constraints
        if (isPointSegmentConstraint) {
          constraints.push({
            constraintId: obj.id,
            segmentOrPointId: otherSegmentId,
          })
        }
      }
    }
    return constraints
  }

  // Helper to find point-segment constraints that involve the segment ID itself (not just endpoints)
  // These need to be converted to point-point constraints and moved to the appropriate endpoint
  // Returns constraints that involve the segment ID but NOT the endpoint IDs (to avoid duplicates)
  const findPointSegmentConstraintsOnSegment = (
    segmentId: number,
    startPointId: number,
    endPointId: number,
    splitPointCoords: Coords2d | null = null
  ): {
    startConstraints: Array<{ constraintId: number; pointId: number }>
    endConstraints: Array<{ constraintId: number; pointId: number }>
  } => {
    const startConstraints: Array<{ constraintId: number; pointId: number }> =
      []
    const endConstraints: Array<{ constraintId: number; pointId: number }> = []

    // Get the segment to determine its type and get endpoint coordinates
    const segment = objects.find(
      (obj) => obj.id === segmentId && obj.kind?.type === 'Segment'
    )
    if (!segment || segment.kind?.type !== 'Segment') {
      return { startConstraints, endConstraints }
    }

    // Get endpoint coordinates for distance calculation
    let segmentStartCoords: Coords2d | null = null
    let segmentEndCoords: Coords2d | null = null

    if (segment.kind.segment.type === 'Line') {
      segmentStartCoords = getPositionCoordsForLine(segment, 'start', objects)
      segmentEndCoords = getPositionCoordsForLine(segment, 'end', objects)
    } else if (segment.kind.segment.type === 'Arc') {
      segmentStartCoords = getPositionCoordsFromArc(segment, 'start', objects)
      segmentEndCoords = getPositionCoordsFromArc(segment, 'end', objects)
    }

    if (!segmentStartCoords || !segmentEndCoords) {
      return { startConstraints, endConstraints }
    }

    // Calculate split point parametric position if provided
    let splitPointT: number | null = null
    if (splitPointCoords) {
      if (segment.kind.segment.type === 'Line') {
        splitPointT = projectPointOntoSegment(
          splitPointCoords,
          segmentStartCoords,
          segmentEndCoords
        )
      } else if (segment.kind.segment.type === 'Arc') {
        const segmentCenter = getPositionCoordsFromArc(
          segment,
          'center',
          objects
        )
        if (segmentCenter) {
          splitPointT = projectPointOntoArc(
            splitPointCoords,
            segmentCenter,
            segmentStartCoords,
            segmentEndCoords
          )
        }
      }
    }

    for (const obj of objects) {
      if (
        obj?.kind?.type === 'Constraint' &&
        obj.kind.constraint.type === 'Coincident'
      ) {
        const constraintSegments = obj.kind.constraint.segments
        // Only consider constraints that involve the segment ID
        if (!constraintSegments.includes(segmentId)) {
          continue
        }

        // Skip if the constraint also involves the endpoint IDs directly
        // (those constraints stay on the endpoints and are not moved)
        if (
          constraintSegments.includes(startPointId) ||
          constraintSegments.includes(endPointId)
        ) {
          continue
        }

        // Find the other segment/point in the constraint
        const otherId = constraintSegments.find((id) => id !== segmentId)
        if (otherId === undefined) {
          continue
        }

        const otherObj = objects[otherId]
        // Check if the other is a point (point-segment constraint)
        const isPoint =
          otherObj?.kind?.type === 'Segment' &&
          otherObj.kind.segment.type === 'Point'

        if (!isPoint) {
          continue
        }

        // Get the point's coordinates to determine which endpoint it's closer to
        const pointObj = objects[otherId]
        if (
          !pointObj ||
          pointObj.kind?.type !== 'Segment' ||
          pointObj.kind.segment.type !== 'Point'
        ) {
          continue
        }

        const pointCoords: Coords2d = [
          pointObj.kind.segment.position.x.value,
          pointObj.kind.segment.position.y.value,
        ]

        // Project the point onto the segment to get its parametric position
        let t: number
        if (segment.kind.segment.type === 'Line') {
          t = projectPointOntoSegment(
            pointCoords,
            segmentStartCoords,
            segmentEndCoords
          )
        } else if (segment.kind.segment.type === 'Arc') {
          const segmentCenter = getPositionCoordsFromArc(
            segment,
            'center',
            objects
          )
          if (!segmentCenter) {
            continue
          }
          t = projectPointOntoArc(
            pointCoords,
            segmentCenter,
            segmentStartCoords,
            segmentEndCoords
          )
        } else {
          continue
        }

        // Check if there's a point-point constraint between the point and an endpoint
        // If there is, the constraint should stay on that endpoint (not move)
        let isCoincidentWithStartPoint = false
        let isCoincidentWithEndPoint = false
        for (const constraintId of findPointPointCoincidentConstraints(
          otherId
        )) {
          const constraintObj = objects[constraintId]
          if (
            constraintObj?.kind?.type === 'Constraint' &&
            constraintObj.kind.constraint.type === 'Coincident'
          ) {
            const constraintSegments = constraintObj.kind.constraint.segments
            if (constraintSegments.includes(startPointId)) {
              isCoincidentWithStartPoint = true
            }
            if (constraintSegments.includes(endPointId)) {
              isCoincidentWithEndPoint = true
            }
          }
        }

        // Geometric checks: distance to endpoints and parametric position
        const distToStart = Math.sqrt(
          (pointCoords[0] - segmentStartCoords[0]) ** 2 +
            (pointCoords[1] - segmentStartCoords[1]) ** 2
        )
        const distToEnd = Math.sqrt(
          (pointCoords[0] - segmentEndCoords[0]) ** 2 +
            (pointCoords[1] - segmentEndCoords[1]) ** 2
        )
        const isAtStart =
          Math.abs(t - 0) < EPSILON_POINT_ON_SEGMENT ||
          distToStart < EPSILON_POINT_ON_SEGMENT
        const isAtEnd =
          Math.abs(t - 1) < EPSILON_POINT_ON_SEGMENT ||
          distToEnd < EPSILON_POINT_ON_SEGMENT

        // Decision table for split trims:
        // - Constraints at/coincident with start endpoint → stay on original start (not moved)
        // - Constraints at/coincident with end endpoint → stay on original end initially, but will migrate to new segment's end
        // - Constraints on segment body before split point → stay on original segment (not moved, original segment still exists)
        // - Constraints on segment body after split point → migrate to new segment's end
        if (isCoincidentWithStartPoint || isAtStart) {
          // Point is at/coincident with start endpoint - constraint stays on original start (not moved)
          // Don't add to either list
        } else if (isCoincidentWithEndPoint || isAtEnd) {
          // Point is at/coincident with end endpoint - this will be handled by endpoint constraint migration
          // Don't add to either list (endpoint constraints are handled separately)
        } else if (splitPointT !== null) {
          // Use split point to determine which side of the split the constraint is on
          // If constraint is before split point (closer to start), it stays on original segment (not migrated)
          // If constraint is after split point (closer to end), migrate to new segment's end
          // If constraint is AT the split point (within epsilon), don't migrate as point-segment constraint
          // because it would pull arc1.end and arc3.start together. Instead, keep it on the original segment.
          const distToSplitPoint = Math.abs(t - splitPointT)
          if (distToSplitPoint < EPSILON_POINT_ON_SEGMENT * 100) {
            // Point is at the split point - don't migrate as point-segment constraint
            // Keep it on the original segment to avoid pulling both halves of the split segment together
            // Don't add to either list
          } else if (t < splitPointT) {
            // Constraint is on the left side of the split (between start and split point)
            // Original segment still exists from start to split point, so constraint stays (not migrated)
            // Don't add to either list
          } else {
            // Constraint is on the right side of the split (between split point and end)
            // This part becomes the new segment, so migrate to new segment's end
            endConstraints.push({
              constraintId: obj.id,
              pointId: otherId,
            })
          }
        } else {
          // Fallback: use distance to endpoints (geometric check)
          // If closer to start, it stays on original (not migrated)
          // If closer to end, migrate to new segment's end
          if (distToStart < distToEnd) {
            // Constraint is closer to start - stays on original segment (not migrated)
            // Don't add to either list
          } else {
            // Constraint is closer to end - migrate to new segment's end
            endConstraints.push({
              constraintId: obj.id,
              pointId: otherId,
            })
          }
        }
      }
    }

    return { startConstraints, endConstraints }
  }

  if (leftSideNeedsTailCut || rightSideNeedsTailCut) {
    const side = leftSideNeedsTailCut ? leftSide : rightSide
    if (side.type === 'segEndPoint') {
      return new Error('Logic error: side should not be segEndPoint here')
    }
    // The endpoint should be moved to the intersection point on the side that was cut
    // If leftSideNeedsTailCut, we're cutting from the left (start), so move end to leftSide intersection (keep start, move end)
    // If rightSideNeedsTailCut, we're cutting from the right (end), so move start to rightSide intersection (keep end, move start)
    const intersectionCoords = side.trimTerminationCoords
    const endpointToChange = leftSideNeedsTailCut ? 'end' : 'start'

    const coincidentData =
      side.type === 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
        ? {
            intersectingEndpointPointId:
              side.trimSpawnSegmentCoincidentWithAnotherSegmentPointId,
            ...findExistingPointSegmentCoincident(
              trimSpawnId,
              side.intersectingSegId
            ),
          }
        : findExistingPointSegmentCoincident(
            trimSpawnId,
            side.intersectingSegId
          )

    // Find the endpoint that will be trimmed to identify point-point constraints to delete
    const trimSeg = objects.find(
      (obj) => obj.id === trimSpawnId && obj.kind?.type === 'Segment'
    )
    let endpointPointId: number | undefined
    if (trimSeg?.kind?.type === 'Segment') {
      if (
        trimSeg.kind.segment.type === 'Line' ||
        trimSeg.kind.segment.type === 'Arc'
      ) {
        endpointPointId =
          endpointToChange === 'start'
            ? trimSeg.kind.segment.start
            : trimSeg.kind.segment.end
      }
    }

    // Find all point-point coincident constraints on the endpoint that will be trimmed
    const coincidentEndConstraintToDeleteIds =
      endpointPointId !== undefined
        ? findPointPointCoincidentConstraints(endpointPointId)
        : []

    const operations: TrimOperation[] = []

    // Edit the segment first
    operations.push({
      type: 'editSegment',
      segmentId: trimSpawnId,
      endpointChanged: endpointToChange,
      ctor: {
        ...trimSpawnSegment.kind.segment.ctor,
        [endpointToChange]: coordsToApiPoint(intersectionCoords),
      },
    })

    // Add coincident constraint after editing
    operations.push({
      type: 'addCoincidentConstraint',
      segmentId: trimSpawnId,
      endpointChanged: endpointToChange,
      segmentOrPointToMakeCoincidentTo: side.intersectingSegId,
      ...(coincidentData.intersectingEndpointPointId !== undefined
        ? {
            intersectingEndpointPointId:
              coincidentData.intersectingEndpointPointId,
          }
        : {}),
    })

    // Delete old constraints last (must be last since deletes invalidate IDs)
    // Batch all constraint deletions into a single operation
    const allConstraintIdsToDelete: number[] = []
    if (coincidentData.existingPointSegmentConstraintId !== undefined) {
      allConstraintIdsToDelete.push(
        coincidentData.existingPointSegmentConstraintId
      )
    }
    if (coincidentEndConstraintToDeleteIds.length > 0) {
      allConstraintIdsToDelete.push(...coincidentEndConstraintToDeleteIds)
    }
    if (allConstraintIdsToDelete.length > 0) {
      operations.push({
        type: 'deleteConstraints',
        constraintIds: allConstraintIdsToDelete,
      })
    }

    return operations
  }
  const leftSideIntersects =
    leftSide.type === 'intersection' ||
    leftSide.type === 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
  const rightSideIntersects =
    rightSide.type === 'intersection' ||
    rightSide.type === 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
  if (leftSideIntersects && rightSideIntersects) {
    const leftCoincidentData =
      leftSide.type === 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
        ? {
            intersectingEndpointPointId:
              leftSide.trimSpawnSegmentCoincidentWithAnotherSegmentPointId,
            ...findExistingPointSegmentCoincident(
              trimSpawnId,
              leftSide.intersectingSegId
            ),
          }
        : findExistingPointSegmentCoincident(
            trimSpawnId,
            leftSide.intersectingSegId
          )

    const rightCoincidentData =
      rightSide.type === 'trimSpawnSegmentCoincidentWithAnotherSegmentPoint'
        ? {
            intersectingEndpointPointId:
              rightSide.trimSpawnSegmentCoincidentWithAnotherSegmentPointId,
            ...findExistingPointSegmentCoincident(
              trimSpawnId,
              rightSide.intersectingSegId
            ),
          }
        : findExistingPointSegmentCoincident(
            trimSpawnId,
            rightSide.intersectingSegId
          )

    // Find the endpoints of the segment being split
    // Use trimSpawnSegment directly (passed as parameter) to ensure we get the original segment
    // before any editing operations
    let originalStartPointId: number | undefined
    let originalEndPointId: number | undefined
    let originalEndPointCoords: Coords2d | null = null
    if (
      trimSpawnSegment.kind?.type === 'Segment' &&
      (trimSpawnSegment.kind.segment.type === 'Line' ||
        trimSpawnSegment.kind.segment.type === 'Arc')
    ) {
      originalStartPointId = trimSpawnSegment.kind.segment.start
      originalEndPointId = trimSpawnSegment.kind.segment.end // The end that gets trimmed and becomes the new segment's end

      // Get the original end point coordinates before editing
      if (trimSpawnSegment.kind.segment.type === 'Line') {
        originalEndPointCoords = getPositionCoordsForLine(
          trimSpawnSegment,
          'end',
          objects
        )
      } else if (trimSpawnSegment.kind.segment.type === 'Arc') {
        originalEndPointCoords = getPositionCoordsFromArc(
          trimSpawnSegment,
          'end',
          objects
        )
      }
    }

    // Find point-point constraints on both endpoints
    // For the original end point: these should move to new segment's end
    // For the original start point: these should stay on original start (NOT migrated, NOT deleted)
    const pointPointConstraintsToMoveToEnd: Array<{
      constraintId: number
      otherPointId: number
    }> = []

    // Point-point constraints on start endpoint stay on original segment (not migrated)
    // Point-point constraints on end endpoint migrate to new segment's end
    if (originalEndPointId !== undefined) {
      // Point-point constraints on end should move to new segment's end
      const endPointPointConstraints =
        findPointPointCoincidentConstraints(originalEndPointId)
      for (const constraintId of endPointPointConstraints) {
        const constraintObj = objects[constraintId]
        if (
          constraintObj?.kind?.type === 'Constraint' &&
          constraintObj.kind.constraint.type === 'Coincident'
        ) {
          const constraintSegments = constraintObj.kind.constraint.segments
          // Find the other point ID (not originalEndPointId)
          const otherPointId = constraintSegments.find(
            (id) => id !== originalEndPointId
          )
          if (otherPointId !== undefined) {
            pointPointConstraintsToMoveToEnd.push({
              constraintId,
              otherPointId,
            })
          }
        }
      }
    }

    // In a split trim:
    // - Constraints on original end endpoint → migrate to new segment's end
    // - Constraints on original start endpoint → stay on original (NOT migrated)
    // - Constraints on segment body before split → migrate to new segment's start
    // - Constraints on segment body after split → migrate to new segment's end
    // So we need to identify point-segment constraints on endpoints
    // Note: Point-segment constraints on start endpoint stay on original (not migrated)
    // Point-segment constraints on end endpoint migrate to new segment's end
    const pointSegmentConstraintsToMoveToEnd =
      originalEndPointId !== undefined
        ? findPointSegmentCoincidentConstraints(originalEndPointId)
        : []
    // Point-segment constraints on start endpoint stay on original segment (not migrated)
    // We don't need to track these for migration

    // Also find point-segment constraints [pointId, segmentId] where the point is geometrically at the original end point
    // These should migrate to [newSegmentEndPointId, pointId] (point-point), not [pointId, newSegmentId] (point-segment)
    // We need to find these by checking all point-segment constraints involving the segment ID
    // and checking if the point is at the original end point
    const pointSegmentConstraintsAtOriginalEnd: Array<{
      constraintId: number
      pointId: number
    }> = []
    if (originalEndPointCoords) {
      for (const obj of objects) {
        if (
          obj?.kind?.type === 'Constraint' &&
          obj.kind.constraint.type === 'Coincident'
        ) {
          const constraintSegments = obj.kind.constraint.segments
          // Only consider constraints that involve the segment ID but NOT the endpoint IDs
          if (
            !constraintSegments.includes(trimSpawnId) ||
            constraintSegments.includes(originalStartPointId ?? -1) ||
            constraintSegments.includes(originalEndPointId ?? -1)
          ) {
            continue
          }

          // Find the other entity (should be a point)
          const otherId = constraintSegments.find((id) => id !== trimSpawnId)
          if (otherId === undefined) {
            continue
          }

          const otherObj = objects[otherId]
          const isPoint =
            otherObj?.kind?.type === 'Segment' &&
            otherObj.kind.segment.type === 'Point'
          if (!isPoint) {
            continue
          }

          // Check if the point is at the original end point (geometrically)
          // Use post-solve coordinates for both to ensure they match if constraints have moved them
          // TypeScript needs explicit narrowing here
          if (
            otherObj.kind.type !== 'Segment' ||
            otherObj.kind.segment.type !== 'Point'
          ) {
            continue
          }
          const pointCoords: Coords2d = [
            otherObj.kind.segment.position.x.value,
            otherObj.kind.segment.position.y.value,
          ]
          // Also get post-solve coordinates for original end point for comparison
          const originalEndPointObj = objects[originalEndPointId ?? -1]
          const originalEndPointPostSolveCoords: Coords2d | null =
            originalEndPointObj?.kind?.type === 'Segment' &&
            originalEndPointObj.kind.segment.type === 'Point'
              ? [
                  originalEndPointObj.kind.segment.position.x.value,
                  originalEndPointObj.kind.segment.position.y.value,
                ]
              : null

          // Check if point is at original end point (geometrically)
          // Use post-solve coordinates if available, otherwise fall back to ctor coordinates
          const referenceCoords =
            originalEndPointPostSolveCoords ?? originalEndPointCoords
          const distToOriginalEnd = Math.sqrt(
            (pointCoords[0] - referenceCoords[0]) ** 2 +
              (pointCoords[1] - referenceCoords[1]) ** 2
          )

          if (distToOriginalEnd < EPSILON_POINT_ON_SEGMENT) {
            // Point is at the original end point - this should migrate to [newSegmentEndPointId, pointId] (point-point)
            // Also check if there's already a point-point constraint between this point and the original end point
            // If so, the point-segment constraint is redundant and should just be deleted, not migrated
            const hasPointPointConstraint = findPointPointCoincidentConstraints(
              originalEndPointId ?? -1
            ).some((constraintId) => {
              const constraintObj = objects[constraintId]
              if (
                constraintObj?.kind?.type === 'Constraint' &&
                constraintObj.kind.constraint.type === 'Coincident'
              ) {
                return constraintObj.kind.constraint.segments.includes(otherId)
              }
              return false
            })

            if (!hasPointPointConstraint) {
              // No existing point-point constraint - migrate as point-point constraint
              pointSegmentConstraintsAtOriginalEnd.push({
                constraintId: obj.id,
                pointId: otherId,
              })
            }
            // If there's already a point-point constraint, the point-segment constraint is redundant
            // and will be deleted (it's already in constraintsToDelete via the normal flow)
          }
        }
      }
    }

    // Find point-segment constraints that involve the segment ID itself (not just endpoints)
    // These need to be converted to point-point constraints
    // We need to track which constraints we've already found via endpoints to avoid duplicates
    const endpointConstraintIds = new Set<number>()
    pointSegmentConstraintsToMoveToEnd.forEach((c) =>
      endpointConstraintIds.add(c.constraintId)
    )
    // Also track constraints where the point is at the original end point
    pointSegmentConstraintsAtOriginalEnd.forEach((c) =>
      endpointConstraintIds.add(c.constraintId)
    )

    // Get split point coordinates (left and right intersections are the same point)
    // When one side is a point-segment coincident, use the intersection point from the other side
    // as the split point, since the point-segment coincident point should be at the intersection
    // When both sides are intersections, they should be the same point, so use either one
    let splitPointCoords: Coords2d
    if (leftSide.type === 'intersection' && rightSide.type === 'intersection') {
      // Both sides are intersections - they should be the same point
      splitPointCoords = leftSide.trimTerminationCoords
    } else if (leftSide.type === 'intersection') {
      splitPointCoords = leftSide.trimTerminationCoords
    } else if (rightSide.type === 'intersection') {
      splitPointCoords = rightSide.trimTerminationCoords
    } else {
      // Both sides are point-segment coincident - use left side's coords
      splitPointCoords = leftSide.trimTerminationCoords
    }
    // Use splitPointCoords (which prioritizes intersection coords if available)
    // Even if left and right aren't exactly the same due to floating point precision,
    // we use the computed splitPointCoords which should be the most accurate
    const splitPoint = splitPointCoords

    const segmentConstraints =
      originalStartPointId !== undefined && originalEndPointId !== undefined
        ? findPointSegmentConstraintsOnSegment(
            trimSpawnId,
            originalStartPointId,
            originalEndPointId,
            splitPoint
          )
        : { startConstraints: [], endConstraints: [] }

    // Filter out constraints we already found via endpoints to avoid duplicates
    const segmentEndConstraints = segmentConstraints.endConstraints.filter(
      (c) =>
        !endpointConstraintIds.has(c.constraintId) &&
        !pointSegmentConstraintsAtOriginalEnd.some(
          (pc) => pc.constraintId === c.constraintId
        )
    )

    // In a split trim:
    // - The new segment's end equals the original segment's end point, so constraints on the original end should move to the new segment's end
    // - The new segment's start is the split point, so constraints on the original segment (closer to start) should move to the new segment's start
    // So we move constraints from segmentStartConstraints to the new segment's start
    // And we move constraints from segmentEndConstraints to the new segment's end

    // Get the original end point coordinates to preserve it in the new segment
    // We MUST use originalEndPointCoords which was captured before any editing
    // If it's null, we have a critical error - we can't create the new segment correctly
    if (!originalEndPointCoords) {
      return new Error(
        'Could not get original end point coordinates before editing - this is required for split trim'
      )
    }
    const originalEndCoords = originalEndPointCoords

    // Calculate trim coordinates for both sides
    // Use the actual termination coordinates from leftSide and rightSide
    // These represent the desired new endpoints after considering all geometric entities
    const leftTrimCoords = leftSide.trimTerminationCoords
    const rightTrimCoords = rightSide.trimTerminationCoords

    // Check if the split point is at the original end point
    // If so, we shouldn't create a new segment (it would have zero length)
    const distToOriginalEnd = Math.sqrt(
      (rightTrimCoords[0] - originalEndCoords[0]) ** 2 +
        (rightTrimCoords[1] - originalEndCoords[1]) ** 2
    )
    if (distToOriginalEnd < EPSILON_POINT_ON_SEGMENT) {
      // Split point is at the original end point - this is actually a cutTail, not a split
      // Don't create a new segment, just trim the original segment
      return new Error(
        'Split point is at original end point - this should be handled as cutTail, not split'
      )
    }

    // Build constraintsToMigrate: all constraints that need to move to the new segment
    // Decision table:
    // - Constraints on original start endpoint → stay on original (NOT migrated)
    // - Constraints on original end endpoint → migrate to new segment's end
    // - Constraints on segment body before split point → migrate to new segment's start
    // - Constraints on segment body after split point → migrate to new segment's end
    const constraintsToMigrate: ConstraintToMigrate[] = []

    // Migrate constraints from original end endpoint to new segment's end
    for (const c of pointPointConstraintsToMoveToEnd) {
      constraintsToMigrate.push({
        constraintId: c.constraintId,
        otherEntityId: c.otherPointId,
        isPointPoint: true,
        attachToEndpoint: 'end',
      })
    }

    // Migrate point-segment constraints from original end endpoint to new segment's end
    // If the other entity is the segment being trimmed, replace it with the new segment
    // Otherwise, attach to the new segment's end endpoint
    for (const c of pointSegmentConstraintsToMoveToEnd) {
      const otherObj = objects[c.segmentOrPointId]
      const isOtherPoint =
        otherObj?.kind?.type === 'Segment' &&
        otherObj.kind.segment.type === 'Point'
      const isOtherSegmentBeingTrimmed = c.segmentOrPointId === trimSpawnId
      constraintsToMigrate.push({
        constraintId: c.constraintId,
        otherEntityId: c.segmentOrPointId,
        isPointPoint: isOtherPoint,
        attachToEndpoint: isOtherSegmentBeingTrimmed ? 'segment' : 'end', // If other is the segment being trimmed, replace segment; otherwise attach to endpoint
      })
    }

    // Migrate point-segment constraints where the point is at the original end point
    // These should become [newSegmentEndPointId, pointId] (point-point), not [pointId, newSegmentId] (point-segment)
    for (const c of pointSegmentConstraintsAtOriginalEnd) {
      constraintsToMigrate.push({
        constraintId: c.constraintId,
        otherEntityId: c.pointId,
        isPointPoint: true, // Convert to point-point constraint
        attachToEndpoint: 'end', // Attach to new segment's end
      })
    }

    // Migrate constraints from segment body (before split) to new segment's start
    // These are segment ID constraints that are closer to start
    // Note: Point-segment constraints on start endpoint stay on original (not migrated)

    // Migrate segment ID constraints that are closer to end (after split point)
    // Note: Constraints closer to start (before split point) stay on original segment
    // because the original segment still exists (just trimmed)
    // These are point-segment constraints [pointId, segmentId] where the point is on the segment body
    // They should become [pointId, newSegmentId] (replacing the segment)
    // BUT: If the point is at the original end point, it should migrate to [newSegmentEndPointId, pointId] (point-point)
    // not [pointId, newSegmentId] (point-segment), because the point is at the endpoint
    // Also: If the point is very close to the split point, we should NOT migrate it as a point-segment constraint
    // because it would pull the two segment halves together. Instead, keep it on the original segment.
    for (const c of segmentEndConstraints) {
      // Check if the point is at the original end point (geometrically)
      // If so, it should be handled by endpoint constraint migration, not segment constraint migration
      const pointObj = objects[c.pointId]
      if (
        pointObj?.kind?.type === 'Segment' &&
        pointObj.kind.segment.type === 'Point' &&
        originalEndPointCoords
      ) {
        const pointCoords: Coords2d = [
          pointObj.kind.segment.position.x.value,
          pointObj.kind.segment.position.y.value,
        ]
        const distToOriginalEnd = Math.sqrt(
          (pointCoords[0] - originalEndPointCoords[0]) ** 2 +
            (pointCoords[1] - originalEndPointCoords[1]) ** 2
        )
        if (distToOriginalEnd < EPSILON_POINT_ON_SEGMENT) {
          // Point is at the original end point - this should be handled by endpoint constraint migration
          // Skip migrating as segment constraint (it will be handled as endpoint constraint)
          continue
        }
      }

      // Point is on the segment body (not at endpoint, not at split point) - migrate as point-segment constraint
      constraintsToMigrate.push({
        constraintId: c.constraintId,
        otherEntityId: c.pointId,
        isPointPoint: false, // Keep as point-segment, but replace the segment
        attachToEndpoint: 'segment', // Replace old segment with new segment
      })
    }

    // Build constraintsToDelete: all constraints that need to be deleted
    // This includes:
    // - Constraints that are being migrated (they'll be recreated on new segment)
    // - Existing point-segment constraints from terminations (they become point-point)
    // Note: Constraints on original start endpoint stay on original (NOT deleted)
    const constraintsToDelete = new Set<number>()

    // Delete existing point-segment constraints from terminations
    // These become point-point constraints after the split
    if (leftCoincidentData.existingPointSegmentConstraintId !== undefined) {
      constraintsToDelete.add(
        leftCoincidentData.existingPointSegmentConstraintId
      )
    }
    if (rightCoincidentData.existingPointSegmentConstraintId !== undefined) {
      constraintsToDelete.add(
        rightCoincidentData.existingPointSegmentConstraintId
      )
    }

    // Delete all constraints being migrated (they'll be recreated on new segment)
    for (const c of constraintsToMigrate) {
      constraintsToDelete.add(c.constraintId)
    }

    // Find and delete any remaining constraints that involve the segment ID
    // but are not endpoint constraints (those are handled above)
    // These are segment-body constraints that we might have missed
    for (const obj of objects) {
      if (
        obj?.kind?.type === 'Constraint' &&
        obj.kind.constraint.type === 'Coincident'
      ) {
        const constraintSegments = obj.kind.constraint.segments
        if (constraintSegments.includes(trimSpawnId)) {
          // This constraint involves the segment ID
          // Skip if already marked for deletion
          if (constraintsToDelete.has(obj.id)) {
            continue
          }

          // Check if this constraint involves an endpoint
          const involvesStartEndpoint =
            originalStartPointId !== undefined &&
            constraintSegments.includes(originalStartPointId)
          const involvesEndEndpoint =
            originalEndPointId !== undefined &&
            constraintSegments.includes(originalEndPointId)

          // If it involves start endpoint, it stays on original (don't delete)
          // If it involves end endpoint, it should have been in constraintsToMigrate
          // If it's a segment-body constraint, we need to check if it should be migrated
          if (!involvesStartEndpoint) {
            // This is either an end endpoint constraint or a segment-body constraint
            // If it's an end endpoint constraint, it should be in constraintsToMigrate
            // If it's a segment-body constraint, check if it's on the right side of split
            if (!involvesEndEndpoint) {
              // This is a segment-body constraint that we haven't identified yet
              // Check if the point is on the right side of the split
              const otherId = constraintSegments.find(
                (id) => id !== trimSpawnId
              )
              if (otherId !== undefined) {
                const otherObj = objects[otherId]
                const isOtherPoint =
                  otherObj?.kind?.type === 'Segment' &&
                  otherObj.kind.segment.type === 'Point'
                if (isOtherPoint) {
                  // This is a point-segment constraint on the segment body
                  // We need to determine which side of the split it's on
                  // For now, if we haven't identified it, it might be a duplicate or edge case
                  // Don't delete it unless we're sure it should be migrated
                  // Actually, if it's not in constraintsToMigrate and not on an endpoint,
                  // it might be a constraint we missed - but to be safe, don't delete it
                }
              }
            }
          }
        }
      }
    }

    const operations: TrimOperation[] = []

    // Create split segment operation
    operations.push({
      type: 'splitSegment',
      segmentId: trimSpawnId,
      leftTrimCoords: leftTrimCoords,
      rightTrimCoords: rightTrimCoords,
      originalEndCoords: originalEndCoords,
      leftSide,
      rightSide,
      leftSideCoincidentData: {
        intersectingSegId: leftSide.intersectingSegId,
        ...(leftCoincidentData.intersectingEndpointPointId !== undefined
          ? {
              intersectingEndpointPointId:
                leftCoincidentData.intersectingEndpointPointId,
            }
          : {}),
        ...(leftCoincidentData.existingPointSegmentConstraintId !== undefined
          ? {
              existingPointSegmentConstraintId:
                leftCoincidentData.existingPointSegmentConstraintId,
            }
          : {}),
      },
      rightSideCoincidentData: {
        intersectingSegId: rightSide.intersectingSegId,
        ...(rightCoincidentData.intersectingEndpointPointId !== undefined
          ? {
              intersectingEndpointPointId:
                rightCoincidentData.intersectingEndpointPointId,
            }
          : {}),
        ...(rightCoincidentData.existingPointSegmentConstraintId !== undefined
          ? {
              existingPointSegmentConstraintId:
                rightCoincidentData.existingPointSegmentConstraintId,
            }
          : {}),
      },
      constraintsToMigrate,
      constraintsToDelete: Array.from(constraintsToDelete),
    })

    return operations
  }
  return new Error('Not implemented')
}

/**
 * Executes the trim strategy operations: deletes, modifies, and adds segments (and constraints).
 * Takes the output of trimStrategy and applies the changes to the scene graph.
 */
export async function executeTrimStrategy({
  strategy,
  rustContext,
  sketchId,
  objects,
}: {
  strategy: TrimOperation[]
  rustContext: RustContext
  sketchId: number
  objects: ApiObject[]
}): Promise<
  | {
      kclSource: { text: string }
      sceneGraphDelta: {
        new_graph: { objects: ApiObject[] }
        new_objects: number[]
        invalidates_ids: boolean
      }
    }
  | Error
> {
  const settings = await jsAppSettings(rustContext.settingsActor)
  let lastResult: {
    kclSource: { text: string }
    sceneGraphDelta: {
      new_graph: { objects: ApiObject[] }
      new_objects: number[]
      invalidates_ids: boolean
    }
  } | null = null
  let invalidates_ids = false

  // Process each operation in the strategy
  for (const operation of strategy) {
    if (operation.type === 'simpleTrim') {
      // Delete the segment
      try {
        const result = await rustContext.deleteObjects(
          0,
          sketchId,
          [], // constraintIds
          [operation.segmentToTrimId], // segmentIds
          settings
        )
        lastResult = result
        invalidates_ids =
          invalidates_ids || result.sceneGraphDelta.invalidates_ids
        // Update objects array for subsequent operations
        if (result.sceneGraphDelta.new_graph.objects) {
          objects = result.sceneGraphDelta.new_graph.objects
        }
      } catch (error) {
        return new Error(`Failed to delete segment: ${error}`)
      }
    } else if (operation.type === 'editSegment') {
      // Edit the segment with the new ctor
      try {
        const segmentToEdit: ExistingSegmentCtor = {
          id: operation.segmentId,
          ctor: operation.ctor,
        }

        const editResult = await rustContext.editSegments(
          0,
          sketchId,
          [segmentToEdit],
          settings
        )
        lastResult = editResult
        invalidates_ids =
          invalidates_ids || editResult.sceneGraphDelta.invalidates_ids
        // Update objects array for subsequent operations
        if (editResult.sceneGraphDelta.new_graph.objects) {
          objects = editResult.sceneGraphDelta.new_graph.objects
        }
      } catch (error) {
        return new Error(`Failed to edit segment: ${error}`)
      }
    } else if (operation.type === 'addCoincidentConstraint') {
      // Add a coincident constraint between the edited segment's endpoint and the intersecting segment/point
      try {
        // Find the edited segment to get the endpoint point ID
        const editedSegment = objects.find(
          (obj) => obj.id === operation.segmentId
        )
        if (!editedSegment || editedSegment.kind?.type !== 'Segment') {
          return new Error(
            `Failed to find edited segment ${operation.segmentId}`
          )
        }

        const segment = editedSegment.kind.segment
        if (
          segment.type !== 'Line' &&
          segment.type !== 'Arc'
          // Note: Circle/Point don't have start/end
        ) {
          return new Error(
            `Unsupported segment type for addCoincidentConstraint: ${segment.type}`
          )
        }

        // Get the endpoint ID after editing (may be different if point was recreated)
        const newSegmentEndpointPointId =
          operation.endpointChanged === 'start' ? segment.start : segment.end

        // Look up the intersecting segment from the updated objects array
        // First try by ID from the operation
        let intersectingSeg = objects.find(
          (obj) => obj?.id === operation.segmentOrPointToMakeCoincidentTo
        )

        // If we can't find it by ID (maybe IDs were invalidated), we need to find it another way
        // Since we don't have the original segment type stored, we'll try to find it by looking
        // for segments that aren't the one we just edited
        if (!intersectingSeg) {
          // Find segments that are not the one we just edited
          // For arcs specifically, there's usually only one, so we can find it that way
          intersectingSeg = objects.find(
            (obj) =>
              obj?.id !== operation.segmentId &&
              obj?.kind?.type === 'Segment' &&
              obj.kind.segment.type === 'Arc'
          )
          // If no arc found, try line segments
          if (!intersectingSeg) {
            intersectingSeg = objects.find(
              (obj) =>
                obj?.id !== operation.segmentId &&
                obj?.kind?.type === 'Segment' &&
                obj.kind.segment.type === 'Line'
            )
          }
        }

        const intersectingSegId =
          intersectingSeg?.id ?? operation.segmentOrPointToMakeCoincidentTo

        // Verify the segment still exists before adding constraint
        const verifySeg = objects.find((obj) => obj?.id === intersectingSegId)
        if (!verifySeg) {
          console.error(
            `Cannot add constraint: intersecting segment ${intersectingSegId} not found in objects array`
          )
        } else {
          // Use point-point constraint if intersectingEndpointPointId is provided,
          // otherwise use point-segment constraint
          const coincidentSegments =
            operation.intersectingEndpointPointId !== undefined
              ? [
                  newSegmentEndpointPointId,
                  operation.intersectingEndpointPointId,
                ]
              : [newSegmentEndpointPointId, intersectingSegId]

          const constraintResult = await rustContext.addConstraint(
            0,
            sketchId,
            {
              type: 'Coincident',
              segments: coincidentSegments,
            } as ApiConstraint,
            settings
          )
          lastResult = constraintResult
          invalidates_ids =
            invalidates_ids || constraintResult.sceneGraphDelta.invalidates_ids
          if (constraintResult.sceneGraphDelta.new_graph.objects) {
            objects = constraintResult.sceneGraphDelta.new_graph.objects
          }
        }
      } catch (error) {
        // If constraint addition fails, log but don't fail the operation
        // The trim operation itself succeeded, the constraint is just a bonus
        console.error('Failed to add coincident constraint:', error)
      }
    } else if (operation.type === 'deleteConstraints') {
      // Delete constraints - this operation should come after other operations
      // since deleting constraints can invalidate IDs
      try {
        const deleteResult = await rustContext.deleteObjects(
          0,
          sketchId,
          operation.constraintIds,
          [], // segmentIds
          settings
        )
        lastResult = deleteResult
        invalidates_ids =
          invalidates_ids || deleteResult.sceneGraphDelta.invalidates_ids
        if (deleteResult.sceneGraphDelta.new_graph.objects) {
          objects = deleteResult.sceneGraphDelta.new_graph.objects
        }
      } catch (error) {
        return new Error(`Failed to delete constraints: ${error}`)
      }
    } else if (operation.type === 'splitSegment') {
      // Split segment operation: edit original segment, create new segment, migrate constraints
      try {
        // Step 1: Edit the original segment (trim left side)
        const originalSegment = objects.find(
          (obj) => obj.id === operation.segmentId
        )
        if (!originalSegment || originalSegment.kind?.type !== 'Segment') {
          return new Error(
            `Failed to find original segment ${operation.segmentId}`
          )
        }

        // We know from trimStrategy that the segment must be Line or Arc
        if (
          originalSegment.kind.segment.type !== 'Line' &&
          originalSegment.kind.segment.type !== 'Arc'
        ) {
          return new Error('Original segment is not a Line or Arc')
        }

        // Extract units from the existing ctor
        // We use the ctor (not solved values) because units are part of the constructor definition,
        // not the solved position. The ctor defines the units that should be used for this segment.
        const originalCtorRaw = originalSegment.kind.segment.ctor
        if (!originalCtorRaw) {
          return new Error('Original segment has no ctor')
        }
        const segmentType = originalSegment.kind.segment.type
        if (
          !('type' in originalCtorRaw) ||
          (segmentType === 'Line' && originalCtorRaw.type !== 'Line') ||
          (segmentType === 'Arc' &&
            originalCtorRaw.type !== 'Arc' &&
            originalCtorRaw.type !== 'TangentArc')
        ) {
          return new Error('Original segment ctor type mismatch')
        }
        // At this point we know originalCtorRaw is a SegmentCtor matching the segment type
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const originalCtor = originalCtorRaw as SegmentCtor

        // Extract units - for Line or Arc, we can get units from the start point
        let units: NumericSuffix = 'Mm'
        if (originalCtor.type === 'Line' || originalCtor.type === 'Arc') {
          const startX = originalCtor.start.x
          if (startX.type === 'Var' || startX.type === 'Number') {
            units = startX.units
          }
        }

        // Helper to convert Coords2d to ApiPoint2d with units
        const coordsToApiPoint = (coords: Coords2d): ApiPoint2d<Expr> => ({
          x: { type: 'Var', value: roundOff(coords[0], 2), units },
          y: { type: 'Var', value: roundOff(coords[1], 2), units },
        })

        // Create the edited ctor - we know originalCtor matches segmentType
        const editedCtor: SegmentCtor =
          segmentType === 'Line'
            ? {
                type: 'Line',
                start: (
                  originalCtor as {
                    type: 'Line'
                    start: ApiPoint2d<Expr>
                    end: ApiPoint2d<Expr>
                  }
                ).start,
                end: coordsToApiPoint(operation.leftTrimCoords),
              }
            : {
                type: 'Arc',
                start: (
                  originalCtor as {
                    type: 'Arc'
                    start: ApiPoint2d<Expr>
                    end: ApiPoint2d<Expr>
                    center: ApiPoint2d<Expr>
                  }
                ).start,
                end: coordsToApiPoint(operation.leftTrimCoords),
                center: (
                  originalCtor as {
                    type: 'Arc'
                    start: ApiPoint2d<Expr>
                    end: ApiPoint2d<Expr>
                    center: ApiPoint2d<Expr>
                  }
                ).center,
              }

        const editResult = await rustContext.editSegments(
          0,
          sketchId,
          [
            {
              id: operation.segmentId,
              ctor: editedCtor,
            },
          ],
          settings
        )
        lastResult = editResult
        invalidates_ids =
          invalidates_ids || editResult.sceneGraphDelta.invalidates_ids
        if (editResult.sceneGraphDelta.new_graph.objects) {
          objects = editResult.sceneGraphDelta.new_graph.objects
        }

        // Step 2: Add coincident constraint for left side
        const editedSegment = objects.find(
          (obj) => obj.id === operation.segmentId
        )
        if (!editedSegment || editedSegment.kind?.type !== 'Segment') {
          return new Error(
            `Failed to find edited segment ${operation.segmentId}`
          )
        }

        const segment = editedSegment.kind.segment
        if (segment.type !== 'Line' && segment.type !== 'Arc') {
          return new Error(
            `Unsupported segment type for split: ${segment.type}`
          )
        }

        const leftSideEndpointPointId = segment.end

        const leftCoincidentSegments =
          operation.leftSideCoincidentData.intersectingEndpointPointId !==
          undefined
            ? [
                leftSideEndpointPointId,
                operation.leftSideCoincidentData.intersectingEndpointPointId,
              ]
            : [
                leftSideEndpointPointId,
                operation.leftSideCoincidentData.intersectingSegId,
              ]

        const leftConstraintResult = await rustContext.addConstraint(
          0,
          sketchId,
          {
            type: 'Coincident',
            segments: leftCoincidentSegments,
          } as ApiConstraint,
          settings
        )
        lastResult = leftConstraintResult
        invalidates_ids =
          invalidates_ids ||
          leftConstraintResult.sceneGraphDelta.invalidates_ids
        if (leftConstraintResult.sceneGraphDelta.new_graph.objects) {
          objects = leftConstraintResult.sceneGraphDelta.new_graph.objects
        }

        // Step 3: Create new segment (right side)
        const newSegmentCtor: SegmentCtor =
          segmentType === 'Line'
            ? {
                type: 'Line',
                start: coordsToApiPoint(operation.rightTrimCoords),
                end: coordsToApiPoint(operation.originalEndCoords),
              }
            : {
                type: 'Arc',
                start: coordsToApiPoint(operation.rightTrimCoords),
                end: coordsToApiPoint(operation.originalEndCoords),
                center:
                  originalCtor.type === 'Arc'
                    ? originalCtor.center
                    : {
                        x: { type: 'Var', value: 0, units: 'Mm' },
                        y: { type: 'Var', value: 0, units: 'Mm' },
                      },
              }

        const addResult = await rustContext.addSegment(
          0,
          sketchId,
          newSegmentCtor,
          undefined, // label
          settings
        )
        lastResult = addResult
        invalidates_ids =
          invalidates_ids || addResult.sceneGraphDelta.invalidates_ids
        if (addResult.sceneGraphDelta.new_graph.objects) {
          objects = addResult.sceneGraphDelta.new_graph.objects
        }

        // Step 4: Find the newly created segment and get its endpoint IDs
        const newSegmentId = addResult.sceneGraphDelta.new_objects.find(
          (id) => {
            const obj = objects[id]
            return (
              obj &&
              obj.kind?.type === 'Segment' &&
              (obj.kind.segment.type === 'Line' ||
                obj.kind.segment.type === 'Arc')
            )
          }
        )

        if (newSegmentId === undefined) {
          return new Error('Failed to find newly created segment')
        }

        const newSegment = objects[newSegmentId]
        if (!newSegment || newSegment.kind?.type !== 'Segment') {
          return new Error('Newly created segment is not a segment')
        }

        let newSegmentStartPointId: number | null = null
        let newSegmentEndPointId: number | null = null
        if (newSegment.kind.segment.type === 'Line') {
          newSegmentStartPointId = newSegment.kind.segment.start
          newSegmentEndPointId = newSegment.kind.segment.end
        } else if (newSegment.kind.segment.type === 'Arc') {
          newSegmentStartPointId = newSegment.kind.segment.start
          newSegmentEndPointId = newSegment.kind.segment.end
        }

        if (newSegmentStartPointId === null || newSegmentEndPointId === null) {
          return new Error(
            'Failed to get endpoint IDs from newly created segment'
          )
        }

        // Step 5: Add coincident constraint for right side (new segment's start)
        // For intersections, we need to find if the intersection point corresponds to an endpoint
        // of the intersecting segment. If so, use point-point constraint. Otherwise, use point-segment.
        let rightCoincidentSegments: number[]
        if (operation.rightSide.type === 'intersection') {
          // For intersections, check if the intersection point is at an endpoint of the intersecting segment
          const intersectingSeg = objects.find(
            (obj) =>
              obj.id === operation.rightSideCoincidentData.intersectingSegId
          )
          let intersectionPointId: number | undefined = undefined

          if (intersectingSeg && intersectingSeg.kind?.type === 'Segment') {
            const intersectionCoords = operation.rightSide.trimTerminationCoords
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
              if (otherStart) {
                const distToStart = Math.sqrt(
                  (intersectionCoords[0] - otherStart[0]) ** 2 +
                    (intersectionCoords[1] - otherStart[1]) ** 2
                )
                if (distToStart < endpointEpsilon) {
                  intersectionPointId = intersectingSeg.kind.segment.start
                }
              }
              if (otherEnd && intersectionPointId === undefined) {
                const distToEnd = Math.sqrt(
                  (intersectionCoords[0] - otherEnd[0]) ** 2 +
                    (intersectionCoords[1] - otherEnd[1]) ** 2
                )
                if (distToEnd < endpointEpsilon) {
                  intersectionPointId = intersectingSeg.kind.segment.end
                }
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
              if (otherStart) {
                const distToStart = Math.sqrt(
                  (intersectionCoords[0] - otherStart[0]) ** 2 +
                    (intersectionCoords[1] - otherStart[1]) ** 2
                )
                if (distToStart < endpointEpsilon) {
                  intersectionPointId = intersectingSeg.kind.segment.start
                }
              }
              if (otherEnd && intersectionPointId === undefined) {
                const distToEnd = Math.sqrt(
                  (intersectionCoords[0] - otherEnd[0]) ** 2 +
                    (intersectionCoords[1] - otherEnd[1]) ** 2
                )
                if (distToEnd < endpointEpsilon) {
                  intersectionPointId = intersectingSeg.kind.segment.end
                }
              }
            }
          }

          rightCoincidentSegments =
            intersectionPointId !== undefined
              ? [newSegmentStartPointId, intersectionPointId]
              : [
                  newSegmentStartPointId,
                  operation.rightSideCoincidentData.intersectingSegId,
                ]
        } else {
          // For point-segment coincident, use the existing logic
          rightCoincidentSegments =
            operation.rightSideCoincidentData.intersectingEndpointPointId !==
            undefined
              ? [
                  newSegmentStartPointId,
                  operation.rightSideCoincidentData.intersectingEndpointPointId,
                ]
              : [
                  newSegmentStartPointId,
                  operation.rightSideCoincidentData.intersectingSegId,
                ]
        }

        const rightConstraintResult = await rustContext.addConstraint(
          0,
          sketchId,
          {
            type: 'Coincident',
            segments: rightCoincidentSegments,
          } as ApiConstraint,
          settings
        )
        lastResult = rightConstraintResult
        invalidates_ids =
          invalidates_ids ||
          rightConstraintResult.sceneGraphDelta.invalidates_ids
        if (rightConstraintResult.sceneGraphDelta.new_graph.objects) {
          objects = rightConstraintResult.sceneGraphDelta.new_graph.objects
        }

        // Step 6: Migrate constraints to new segment
        // Track which points are already constrained to new segment endpoints via point-point constraints
        // to avoid creating redundant point-segment constraints
        const pointsConstrainedToNewSegmentStart = new Set<number>()
        const pointsConstrainedToNewSegmentEnd = new Set<number>()
        if (
          operation.rightSideCoincidentData.intersectingEndpointPointId !==
          undefined
        ) {
          // The right side has a point that becomes coincident with new segment's start
          pointsConstrainedToNewSegmentStart.add(
            operation.rightSideCoincidentData.intersectingEndpointPointId
          )
        }

        // Also track points that will be constrained to new segment's end via point-point constraints
        // (from pointSegmentConstraintsAtOriginalEnd and pointPointConstraintsToMoveToEnd)
        for (const constraintToMigrate of operation.constraintsToMigrate) {
          if (
            constraintToMigrate.attachToEndpoint === 'end' &&
            constraintToMigrate.isPointPoint
          ) {
            // This is a point-point constraint that will attach to new segment's end
            pointsConstrainedToNewSegmentEnd.add(
              constraintToMigrate.otherEntityId
            )
          }
        }

        for (const constraintToMigrate of operation.constraintsToMigrate) {
          try {
            // Skip migrating point-segment constraints if the point is already constrained
            // to the new segment's endpoint via a point-point constraint (redundant)
            if (constraintToMigrate.attachToEndpoint === 'segment') {
              // This is a point-segment constraint [pointId, newSegmentId]
              // Check if pointId is already constrained to newSegmentStartPointId or newSegmentEndPointId
              // If so, the point-point constraint already covers it, so skip the point-segment constraint
              if (
                pointsConstrainedToNewSegmentStart.has(
                  constraintToMigrate.otherEntityId
                ) ||
                pointsConstrainedToNewSegmentEnd.has(
                  constraintToMigrate.otherEntityId
                )
              ) {
                // Point is already constrained to new segment's endpoint via point-point constraint
                // Skip creating redundant point-segment constraint
                continue
              }
            }

            let constraintSegments: number[]
            if (constraintToMigrate.attachToEndpoint === 'segment') {
              // Replace old segment with new segment in point-segment constraint
              // Original: [pointId, oldSegmentId] -> New: [pointId, newSegmentId]
              constraintSegments = [
                constraintToMigrate.otherEntityId,
                newSegmentId,
              ]
            } else {
              // Attach to new segment's endpoint
              const targetEndpointId =
                constraintToMigrate.attachToEndpoint === 'start'
                  ? newSegmentStartPointId
                  : newSegmentEndPointId
              constraintSegments = [
                targetEndpointId,
                constraintToMigrate.otherEntityId,
              ]
            }

            const constraintResult = await rustContext.addConstraint(
              0,
              sketchId,
              {
                type: 'Coincident',
                segments: constraintSegments,
              } as ApiConstraint,
              settings
            )
            lastResult = constraintResult
            invalidates_ids =
              invalidates_ids ||
              constraintResult.sceneGraphDelta.invalidates_ids
            if (constraintResult.sceneGraphDelta.new_graph.objects) {
              objects = constraintResult.sceneGraphDelta.new_graph.objects
            }
          } catch (error) {
            // If constraint addition fails, log but don't fail the operation
            console.error(
              `Failed to migrate constraint ${constraintToMigrate.constraintId} to new segment:`,
              error
            )
          }
        }

        // Step 7: Delete old constraints (must be last since deletes invalidate IDs)
        if (operation.constraintsToDelete.length > 0) {
          try {
            const deleteResult = await rustContext.deleteObjects(
              0,
              sketchId,
              operation.constraintsToDelete,
              [], // segmentIds
              settings
            )
            lastResult = deleteResult
            invalidates_ids =
              invalidates_ids || deleteResult.sceneGraphDelta.invalidates_ids
            if (deleteResult.sceneGraphDelta.new_graph.objects) {
              objects = deleteResult.sceneGraphDelta.new_graph.objects
            }
          } catch (error) {
            // If constraint deletion fails, log but don't fail the operation
            console.error('Failed to delete constraints:', error)
          }
        }
      } catch (error) {
        return new Error(`Failed to split segment: ${error}`)
      }
    }
  }

  if (!lastResult) {
    return new Error('No operations were executed')
  }

  return {
    ...lastResult,
    sceneGraphDelta: {
      ...lastResult.sceneGraphDelta,
      invalidates_ids,
    },
  }
}

/**
 * Creates the onAreaSelectEnd callback for trim operations using TypeScript implementation.
 * This is the original TypeScript implementation for debugging/comparison purposes.
 *
 * @param getContextData - Function to get current context (sceneGraphDelta, sketchId, rustContext)
 * @param onNewSketchOutcome - Callback when a new sketch outcome is available
 */
export function createOnAreaSelectEndCallbackTypescript({
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

      let objects = sceneGraphDelta.new_graph.objects

      // Track the last result to send a single final event at the end
      let lastResult: {
        kclSource: { text: string }
        sceneGraphDelta: {
          new_graph: { objects: ApiObject[] }
          new_objects: number[]
          invalidates_ids: boolean
        }
      } | null = null

      let startIndex = 0
      let iterationCount = 0
      const maxIterations = 1000
      let invalidates_ids: boolean = false

      while (startIndex < points.length - 1 && iterationCount < maxIterations) {
        iterationCount++

        const nextTrimResult = getNextTrimCoords({
          points,
          startIndex,
          objects,
        })

        if (nextTrimResult.type === 'noTrimSpawn') {
          const oldStartIndex = startIndex
          startIndex = nextTrimResult.nextIndex

          // Fail-safe: if nextIndex didn't advance, force it to advance
          if (startIndex <= oldStartIndex) {
            startIndex = oldStartIndex + 1
          }

          // Early exit if we've reached the end of the points array
          if (startIndex >= points.length - 1) {
            break
          }

          continue
        }

        // Found a trim spawn, get terminations
        const terminations = getTrimSpawnTerminations({
          trimSpawnSegId: nextTrimResult.trimSpawnSegId,
          trimSpawnCoords: points,
          objects,
        })

        if (terminations instanceof Error) {
          console.error('Error getting trim terminations:', terminations)
          const oldStartIndex = startIndex
          startIndex = nextTrimResult.nextIndex

          // Fail-safe: if nextIndex didn't advance, force it to advance
          if (startIndex <= oldStartIndex) {
            startIndex = oldStartIndex + 1
          }
          continue
        }

        // Get the trim spawn segment
        const trimSpawnSegment = objects[nextTrimResult.trimSpawnSegId]
        if (!trimSpawnSegment) {
          console.error(
            'Trim spawn segment not found:',
            nextTrimResult.trimSpawnSegId
          )
          const oldStartIndex = startIndex
          startIndex = nextTrimResult.nextIndex

          // Fail-safe: if nextIndex didn't advance, force it to advance
          if (startIndex <= oldStartIndex) {
            startIndex = oldStartIndex + 1
          }
          continue
        }

        // Get trim strategy
        const strategy = trimStrategy({
          trimSpawnId: nextTrimResult.trimSpawnSegId,
          trimSpawnSegment,
          leftSide: terminations.leftSide,
          rightSide: terminations.rightSide,
          objects,
        })
        if (strategy instanceof Error) {
          console.error('Error determining trim strategy:', strategy)
          const oldStartIndex = startIndex
          startIndex = nextTrimResult.nextIndex

          // Fail-safe: if nextIndex didn't advance, force it to advance
          if (startIndex <= oldStartIndex) {
            startIndex = oldStartIndex + 1
          }
          continue
        }

        const result = await executeTrimStrategy({
          strategy,
          rustContext,
          sketchId,
          objects,
        })

        if (result instanceof Error) {
          console.error('[TRIM] Error executing trim strategy:', result)
        } else {
          // CRITICAL FIX: Update objects array from result for subsequent operations
          // This ensures that if there are multiple trim operations in the same drag,
          // or if invalidates_ids is true, we use the fresh objects
          objects = result.sceneGraphDelta.new_graph.objects

          // Store the result but don't send event yet - we'll send one final event at the end
          lastResult = result
          invalidates_ids =
            invalidates_ids || result.sceneGraphDelta.invalidates_ids
        }

        // Move to next segment (or re-check same segment if deletion occurred)
        // When a segment is deleted, nextIndex will be the same point index, allowing us to
        // find additional intersections on the same polyline segment
        const oldStartIndex = startIndex
        startIndex = nextTrimResult.nextIndex

        // Fail-safe: if nextIndex didn't advance and we didn't delete, force it to advance
        // This prevents infinite loops in edge cases
        if (startIndex <= oldStartIndex) {
          // Check if we actually deleted a segment (simpleTrim operation)
          const wasDeleted =
            isArray(strategy) && strategy.some((op) => op.type === 'simpleTrim')
          if (!wasDeleted) {
            startIndex = oldStartIndex + 1
          }
        }
      }

      if (iterationCount >= maxIterations) {
        console.error(
          `ERROR: Reached max iterations (${maxIterations}). Breaking loop to prevent infinite loop.`
        )
      }

      // Send a single final event with the last result (if any operations were performed)
      if (lastResult) {
        onNewSketchOutcome({
          ...lastResult,
          sceneGraphDelta: {
            ...lastResult.sceneGraphDelta,
            invalidates_ids,
          },
        })
      }
    } catch (error) {
      console.error('[TRIM] Exception in onAreaSelectEnd:', error)
    }
  }
}

/**
 * Creates the onAreaSelectEnd callback for trim operations.
 * Handles the trim flow by processing trim points and executing trim strategies.
 *
 * @param getContextData - Function to get current context (sceneGraphDelta, sketchId, rustContext)
 * @param executeTrimStrategy - Function to execute a trim strategy
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
