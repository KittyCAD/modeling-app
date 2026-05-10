import {
  calculateBoxBounds,
  isIntersectionSelectionMode,
  project3DToScreen,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'
import {
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector2,
  Vector3,
} from 'three'

export type OpenCascadeAreaSelectionMode = 'contains' | 'intersects'

export type OpenCascadeAreaSelectionGeometry = {
  points?: Vector3[]
  segments?: Array<[Vector3, Vector3]>
  triangles?: Array<[Vector3, Vector3, Vector3]>
}

export function openCascadeAreaSelectionBox({
  startPoint,
  currentPoint,
  camera,
  viewportSize,
}: {
  startPoint: Vector3
  currentPoint: Vector3
  camera: OrthographicCamera | PerspectiveCamera
  viewportSize: Vector2
}): {
  min: Vector2
  max: Vector2
  mode: OpenCascadeAreaSelectionMode
} {
  const startPx = project3DToScreen(startPoint, camera, viewportSize)
  const currentPx = project3DToScreen(currentPoint, camera, viewportSize)
  const { min, max } = calculateBoxBounds(startPx, currentPx)
  return {
    min,
    max,
    mode: isIntersectionSelectionMode(startPx, currentPx)
      ? 'intersects'
      : 'contains',
  }
}

export function isOpenCascadeAreaSelectionMatch({
  geometry,
  camera,
  viewportSize,
  boxMin,
  boxMax,
  mode,
}: {
  geometry: OpenCascadeAreaSelectionGeometry
  camera: OrthographicCamera | PerspectiveCamera
  viewportSize: Vector2
  boxMin: Vector2
  boxMax: Vector2
  mode: OpenCascadeAreaSelectionMode
}): boolean {
  const projectedPoints = (geometry.points || []).map((point) =>
    project3DToScreen(point, camera, viewportSize)
  )

  if (mode === 'contains') {
    return (
      projectedPoints.length > 0 &&
      projectedPoints.every((point) => isPointInBox(point, boxMin, boxMax))
    )
  }

  if (projectedPoints.some((point) => isPointInBox(point, boxMin, boxMax))) {
    return true
  }

  for (const [start, end] of geometry.segments || []) {
    const startPx = project3DToScreen(start, camera, viewportSize)
    const endPx = project3DToScreen(end, camera, viewportSize)
    if (doesLineSegmentIntersectBox2d(startPx, endPx, boxMin, boxMax)) {
      return true
    }
  }

  for (const triangle of geometry.triangles || []) {
    const projectedTriangle = triangle.map((point) =>
      project3DToScreen(point, camera, viewportSize)
    ) as [Vector2, Vector2, Vector2]
    if (doesTriangleIntersectBox(projectedTriangle, boxMin, boxMax)) {
      return true
    }
  }

  return false
}

function isPointInBox(point: Vector2, min: Vector2, max: Vector2) {
  return (
    point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y
  )
}

function doesTriangleIntersectBox(
  [a, b, c]: [Vector2, Vector2, Vector2],
  boxMin: Vector2,
  boxMax: Vector2
) {
  if (
    isPointInBox(a, boxMin, boxMax) ||
    isPointInBox(b, boxMin, boxMax) ||
    isPointInBox(c, boxMin, boxMax)
  ) {
    return true
  }

  if (
    doesLineSegmentIntersectBox2d(a, b, boxMin, boxMax) ||
    doesLineSegmentIntersectBox2d(b, c, boxMin, boxMax) ||
    doesLineSegmentIntersectBox2d(c, a, boxMin, boxMax)
  ) {
    return true
  }

  return boxCorners(boxMin, boxMax).some((corner) =>
    isPointInTriangle(corner, a, b, c)
  )
}

function doesLineSegmentIntersectBox2d(
  start: Vector2,
  end: Vector2,
  boxMin: Vector2,
  boxMax: Vector2
) {
  if (
    isPointInBox(start, boxMin, boxMax) ||
    isPointInBox(end, boxMin, boxMax)
  ) {
    return true
  }

  const boxEdges: Array<[Vector2, Vector2]> = [
    [new Vector2(boxMin.x, boxMin.y), new Vector2(boxMax.x, boxMin.y)],
    [new Vector2(boxMax.x, boxMin.y), new Vector2(boxMax.x, boxMax.y)],
    [new Vector2(boxMax.x, boxMax.y), new Vector2(boxMin.x, boxMax.y)],
    [new Vector2(boxMin.x, boxMax.y), new Vector2(boxMin.x, boxMin.y)],
  ]
  return boxEdges.some(([edgeStart, edgeEnd]) =>
    doLineSegmentsIntersect(start, end, edgeStart, edgeEnd)
  )
}

function doLineSegmentsIntersect(
  a: Vector2,
  b: Vector2,
  c: Vector2,
  d: Vector2
) {
  const orientationA = orientation(a, b, c)
  const orientationB = orientation(a, b, d)
  const orientationC = orientation(c, d, a)
  const orientationD = orientation(c, d, b)

  if (orientationA !== orientationB && orientationC !== orientationD) {
    return true
  }

  return (
    (orientationA === 0 && isPointOnSegment(c, a, b)) ||
    (orientationB === 0 && isPointOnSegment(d, a, b)) ||
    (orientationC === 0 && isPointOnSegment(a, c, d)) ||
    (orientationD === 0 && isPointOnSegment(b, c, d))
  )
}

function orientation(a: Vector2, b: Vector2, c: Vector2) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) < Number.EPSILON) {
    return 0
  }
  return value > 0 ? 1 : 2
}

function isPointOnSegment(point: Vector2, start: Vector2, end: Vector2) {
  return (
    point.x <= Math.max(start.x, end.x) &&
    point.x >= Math.min(start.x, end.x) &&
    point.y <= Math.max(start.y, end.y) &&
    point.y >= Math.min(start.y, end.y)
  )
}

function boxCorners(min: Vector2, max: Vector2) {
  return [
    new Vector2(min.x, min.y),
    new Vector2(max.x, min.y),
    new Vector2(max.x, max.y),
    new Vector2(min.x, max.y),
  ]
}

function isPointInTriangle(point: Vector2, a: Vector2, b: Vector2, c: Vector2) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
  if (Math.abs(denominator) < Number.EPSILON) {
    return false
  }

  const alpha =
    ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) /
    denominator
  const beta =
    ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) /
    denominator
  const gamma = 1 - alpha - beta

  return alpha >= 0 && beta >= 0 && gamma >= 0
}
