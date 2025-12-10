import {
  type Group,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Mesh,
  Vector3,
  Vector2,
  BufferGeometry,
} from 'three'

export const AREA_SELECT_BORDER_WIDTH = 2
export const LINE_EXTENSION_SIZE = 12
const LABEL_VERTICAL_OFFSET = 12

/**
 * Projects a 3D point to 2D screen coordinates.
 * Pure function that converts world space coordinates to screen pixel coordinates.
 *
 * @param point3D - The 3D point in world space
 * @param camera - The camera used for projection
 * @param viewportSize - The viewport size in pixels (width, height)
 * @returns The 2D screen coordinates in pixels
 */
export function project3DToScreen(
  point3D: Vector3,
  camera: OrthographicCamera | PerspectiveCamera,
  viewportSize: Vector2
): Vector2 {
  const projected = point3D.clone().project(camera)
  return new Vector2(
    ((projected.x + 1) / 2) * viewportSize.x,
    ((1 - projected.y) / 2) * viewportSize.y
  )
}

/**
 * Calculates the bounding box in screen space from two screen points.
 * Pure function that determines the min/max bounds of a selection box.
 *
 * @param point1 - First screen point
 * @param point2 - Second screen point
 * @returns Object containing min and max bounds of the box
 */
export function calculateBoxBounds(
  point1: Vector2,
  point2: Vector2
): { min: Vector2; max: Vector2 } {
  return {
    min: new Vector2(
      Math.min(point1.x, point2.x),
      Math.min(point1.y, point2.y)
    ),
    max: new Vector2(
      Math.max(point1.x, point2.x),
      Math.max(point1.y, point2.y)
    ),
  }
}

/**
 * Determines the area selection mode based on drag direction.
 * Pure function that returns true for intersection mode (right-to-left drag),
 * false for contains mode (left-to-right drag).
 *
 * @param startPoint - The starting screen point
 * @param currentPoint - The current screen point
 * @returns True if intersection mode, false if contains mode
 */
export function isIntersectionSelectionMode(
  startPoint: Vector2,
  currentPoint: Vector2
): boolean {
  return startPoint.x > currentPoint.x
}

/**
 * Checks if two axis-aligned bounding boxes intersect.
 * Pure function that determines if two boxes overlap in screen space.
 *
 * @param box1Min - Minimum corner of first box
 * @param box1Max - Maximum corner of first box
 * @param box2Min - Minimum corner of second box
 * @param box2Max - Maximum corner of second box
 * @returns True if boxes intersect, false otherwise
 */
export function doBoxesIntersect(
  box1Min: Vector2,
  box1Max: Vector2,
  box2Min: Vector2,
  box2Max: Vector2
): boolean {
  // Two axis-aligned boxes intersect if:
  // - box1Min.x <= box2Max.x AND box1Max.x >= box2Min.x AND
  // - box1Min.y <= box2Max.y AND box1Max.y >= box2Min.y
  return (
    box1Min.x <= box2Max.x &&
    box1Max.x >= box2Min.x &&
    box1Min.y <= box2Max.y &&
    box1Max.y >= box2Min.y
  )
}

/**
 * Checks if all points are contained within a bounding box.
 * Pure function that determines if all points are inside the box boundaries.
 *
 * @param points - Array of points to check
 * @param boxMin - Minimum corner of the box
 * @param boxMax - Maximum corner of the box
 * @returns True if all points are contained, false otherwise
 */
export function areAllPointsContained(
  points: Array<Vector2>,
  boxMin: Vector2,
  boxMax: Vector2
): boolean {
  return points.every(
    (point) =>
      point.x >= boxMin.x &&
      point.x <= boxMax.x &&
      point.y >= boxMin.y &&
      point.y <= boxMax.y
  )
}

/**
 * Pure function: Calculates all selection box properties from 3D points
 * Returns all computed values needed to render and position the selection box
 */
export function calculateSelectionBoxProperties(
  startPoint3D: Vector3,
  currentPoint3D: Vector3,
  camera: OrthographicCamera | PerspectiveCamera,
  viewportSize: Vector2
): {
  widthPx: number
  heightPx: number
  boxMinPx: Vector2
  boxMaxPx: Vector2
  startPx: Vector2
  currentPx: Vector2
  isIntersectionBox: boolean
  isDraggingUpward: boolean
  borderStyle: 'dashed' | 'solid'
  center3D: Vector3
} {
  const startPx = project3DToScreen(startPoint3D, camera, viewportSize)
  const currentPx = project3DToScreen(currentPoint3D, camera, viewportSize)

  const { min: boxMinPx, max: boxMaxPx } = calculateBoxBounds(
    startPx,
    currentPx
  )

  const widthPx = boxMaxPx.x - boxMinPx.x
  const heightPx = boxMaxPx.y - boxMinPx.y

  const isIntersectionBox = isIntersectionSelectionMode(startPx, currentPx)
  const isDraggingUpward = startPx.y > currentPx.y
  const borderStyle = isIntersectionBox ? 'dashed' : 'solid'

  const center3D = new Vector3()
    .addVectors(startPoint3D, currentPoint3D)
    .multiplyScalar(0.5)

  return {
    widthPx,
    heightPx,
    boxMinPx,
    boxMaxPx,
    startPx,
    currentPx,
    isIntersectionBox,
    isDraggingUpward,
    borderStyle,
    center3D,
  }
}

/**
 * Pure function: Calculates label positioning relative to box center
 * Determines where labels should be positioned based on drag start point
 */
export function calculateLabelPositioning(
  startPx: Vector2,
  boxMinPx: Vector2,
  boxMaxPx: Vector2,
  isDraggingUpward: boolean
): {
  offsetX: number
  offsetY: number
  finalOffsetY: number
  startX: number
  startY: number
} {
  const centerPx = new Vector2(
    (boxMinPx.x + boxMaxPx.x) / 2,
    (boxMinPx.y + boxMaxPx.y) / 2
  )

  const offsetX = startPx.x - centerPx.x
  const offsetY = startPx.y - centerPx.y

  const verticalOffset = isDraggingUpward
    ? LABEL_VERTICAL_OFFSET
    : -LABEL_VERTICAL_OFFSET
  const finalOffsetY = offsetY + verticalOffset

  const startX = offsetX
  const startY = offsetY

  return {
    offsetX,
    offsetY,
    finalOffsetY,
    startX,
    startY,
  }
}

/**
 * Pure function: Calculates corner line styles and positions
 * Determines how corner lines should be positioned and sized
 */
export function calculateCornerLineStyles(
  startX: number,
  startY: number,
  lineExtensionSize: number,
  borderWidth: number
): {
  verticalLine: {
    height: string
    bottom?: string
    top?: string
    left?: string
    right?: string
  }
  horizontalLine: {
    width: string
    left?: string
    right?: string
    top?: string
    bottom?: string
  }
} {
  const verticalLine: {
    height: string
    bottom?: string
    top?: string
    left?: string
    right?: string
  } = {
    height: `${lineExtensionSize}px`,
  }

  if (startY > 0) {
    verticalLine.bottom = `-${lineExtensionSize + borderWidth}px`
  } else {
    verticalLine.top = `-${lineExtensionSize + borderWidth}px`
  }

  if (startX > 0) {
    verticalLine.right = `-${borderWidth}px`
  } else {
    verticalLine.left = `-${borderWidth}px`
  }

  const horizontalLine: {
    width: string
    left?: string
    right?: string
    top?: string
    bottom?: string
  } = {
    width: `${lineExtensionSize}px`,
  }

  if (startX < 0) {
    horizontalLine.left = `-${lineExtensionSize + borderWidth}px`
  } else {
    horizontalLine.right = `-${lineExtensionSize + borderWidth}px`
  }

  if (startY > 0) {
    horizontalLine.bottom = `-${borderWidth}px`
  } else {
    horizontalLine.top = `-${borderWidth}px`
  }

  return {
    verticalLine,
    horizontalLine,
  }
}

/**
 * Pure function: Calculates label styles based on selection mode
 * Determines opacity and font weight for intersection/contains labels
 */
export function calculateLabelStyles(isIntersectionBox: boolean): {
  intersectsLabel: { opacity: string; fontWeight: string }
  containsLabel: { opacity: string; fontWeight: string }
} {
  if (isIntersectionBox) {
    return {
      intersectsLabel: { opacity: '1', fontWeight: '600' },
      containsLabel: { opacity: '0.4', fontWeight: '400' },
    }
  } else {
    return {
      intersectsLabel: { opacity: '0.4', fontWeight: '400' },
      containsLabel: { opacity: '1', fontWeight: '600' },
    }
  }
}

/**
 * Pure function: Transforms world position to local space
 * Converts 3D world coordinates to the sketch solve group's local coordinate system
 */
export function transformToLocalSpace(
  center3D: Vector3,
  sketchSceneGroup: Group | null
): Vector3 {
  const localCenter = new Vector3()
  if (sketchSceneGroup) {
    sketchSceneGroup.worldToLocal(localCenter.copy(center3D))
  } else {
    localCenter.copy(center3D)
  }
  return localCenter
}

/**
 * Pure function: Extracts triangles (polygons) from a Three.js mesh geometry
 * Returns an array of triangles, where each triangle is an array of 3 Vector3 vertices in world space
 */
export function extractTrianglesFromMesh(
  mesh: Mesh,
  camera: OrthographicCamera | PerspectiveCamera,
  viewportSize: Vector2
): Array<[Vector2, Vector2, Vector2]> {
  const geometry = mesh.geometry
  // ExtrudeGeometry extends BufferGeometry, so this check works for both
  if (!(geometry instanceof BufferGeometry)) {
    return []
  }

  mesh.updateMatrixWorld()
  const positionAttr = geometry.getAttribute('position')
  if (!positionAttr) {
    return []
  }

  const positions = positionAttr.array as Float32Array
  const triangles: Array<[Vector2, Vector2, Vector2]> = []

  // Get indices or generate sequential indices
  let indices: Array<number>
  if (geometry.index) {
    const idxArr = geometry.index.array as ArrayLike<number>
    indices = Array.from(idxArr)
  } else {
    indices = Array.from({ length: positionAttr.count }, (_, i) => i)
  }

  // Extract triangles (every 3 indices form a triangle)
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3
    const i1 = indices[i + 1] * 3
    const i2 = indices[i + 2] * 3

    // Get vertices in local space
    const v0 = new Vector3(positions[i0], positions[i0 + 1], positions[i0 + 2])
    const v1 = new Vector3(positions[i1], positions[i1 + 1], positions[i1 + 2])
    const v2 = new Vector3(positions[i2], positions[i2 + 1], positions[i2 + 2])

    // Transform to world space
    v0.applyMatrix4(mesh.matrixWorld)
    v1.applyMatrix4(mesh.matrixWorld)
    v2.applyMatrix4(mesh.matrixWorld)

    // Project to screen space
    const screen0 = project3DToScreen(v0, camera, viewportSize)
    const screen1 = project3DToScreen(v1, camera, viewportSize)
    const screen2 = project3DToScreen(v2, camera, viewportSize)

    triangles.push([screen0, screen1, screen2])
  }

  return triangles
}

/**
 * Pure function: Checks if a point is inside a 2D axis-aligned box
 */
function isPointInBox(
  point: Vector2,
  boxMin: Vector2,
  boxMax: Vector2
): boolean {
  return (
    point.x >= boxMin.x &&
    point.x <= boxMax.x &&
    point.y >= boxMin.y &&
    point.y <= boxMax.y
  )
}

/**
 * Pure function: Checks if a line segment intersects with a 2D axis-aligned box
 * Uses Liang-Barsky algorithm for efficient line-box intersection
 */
function doesLineSegmentIntersectBox(
  p0: Vector2,
  p1: Vector2,
  boxMin: Vector2,
  boxMax: Vector2
): boolean {
  // If either endpoint is inside the box, it intersects
  if (isPointInBox(p0, boxMin, boxMax) || isPointInBox(p1, boxMin, boxMax)) {
    return true
  }

  // Check if line segment intersects box edges
  // Use parametric line equation: P(t) = p0 + t * (p1 - p0), t in [0, 1]
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y

  // Check intersection with box edges
  // Left edge: x = boxMin.x
  if (dx !== 0) {
    const t = (boxMin.x - p0.x) / dx
    if (t >= 0 && t <= 1) {
      const y = p0.y + t * dy
      if (y >= boxMin.y && y <= boxMax.y) {
        return true
      }
    }
  }

  // Right edge: x = boxMax.x
  if (dx !== 0) {
    const t = (boxMax.x - p0.x) / dx
    if (t >= 0 && t <= 1) {
      const y = p0.y + t * dy
      if (y >= boxMin.y && y <= boxMax.y) {
        return true
      }
    }
  }

  // Top edge: y = boxMin.y
  if (dy !== 0) {
    const t = (boxMin.y - p0.y) / dy
    if (t >= 0 && t <= 1) {
      const x = p0.x + t * dx
      if (x >= boxMin.x && x <= boxMax.x) {
        return true
      }
    }
  }

  // Bottom edge: y = boxMax.y
  if (dy !== 0) {
    const t = (boxMax.y - p0.y) / dy
    if (t >= 0 && t <= 1) {
      const x = p0.x + t * dx
      if (x >= boxMin.x && x <= boxMax.x) {
        return true
      }
    }
  }

  return false
}

/**
 * Pure function: Checks if a triangle (polygon) intersects with a 2D axis-aligned box
 * Returns true if the triangle intersects the box (not just contained)
 */
export function doesTriangleIntersectBox(
  triangle: [Vector2, Vector2, Vector2],
  boxMin: Vector2,
  boxMax: Vector2
): boolean {
  const [v0, v1, v2] = triangle

  // Check if any vertex is inside the box
  if (
    isPointInBox(v0, boxMin, boxMax) ||
    isPointInBox(v1, boxMin, boxMax) ||
    isPointInBox(v2, boxMin, boxMax)
  ) {
    return true
  }

  // Check if any triangle edge intersects the box
  if (
    doesLineSegmentIntersectBox(v0, v1, boxMin, boxMax) ||
    doesLineSegmentIntersectBox(v1, v2, boxMin, boxMax) ||
    doesLineSegmentIntersectBox(v2, v0, boxMin, boxMax)
  ) {
    return true
  }

  // Check if box is entirely inside triangle (for convex triangles)
  // This handles cases where the box is inside a large triangle
  const boxCorners = [
    new Vector2(boxMin.x, boxMin.y),
    new Vector2(boxMax.x, boxMin.y),
    new Vector2(boxMax.x, boxMax.y),
    new Vector2(boxMin.x, boxMax.y),
  ]

  // Check if all box corners are inside the triangle
  // Using barycentric coordinates or point-in-triangle test
  const allCornersInside = boxCorners.every((corner) => {
    return isPointInTriangle(corner, v0, v1, v2)
  })

  if (allCornersInside) {
    return true
  }

  return false
}

/**
 * Pure function: Checks if a point is inside a triangle using barycentric coordinates
 */
function isPointInTriangle(
  point: Vector2,
  v0: Vector2,
  v1: Vector2,
  v2: Vector2
): boolean {
  const dX = point.x - v2.x
  const dY = point.y - v2.y
  const dX20 = v2.x - v0.x
  const dY20 = v2.y - v0.y
  const dX21 = v2.x - v1.x
  const dY21 = v2.y - v1.y

  const denom = dX20 * dY21 - dX21 * dY20
  if (Math.abs(denom) < 1e-10) {
    return false // Degenerate triangle
  }

  const a = (dX * dY21 - dY * dX21) / denom
  const b = (dX20 * dY - dY20 * dX) / denom
  const c = 1 - a - b

  return a >= 0 && b >= 0 && c >= 0
}

/**
 * Pure function: Checks if any polygon in an array intersects with a box
 * Uses binary tree pattern for efficiency: starts in middle, keeps dividing
 * Returns true as soon as one polygon intersects (early exit)
 */
export function doesAnyPolygonIntersectBox(
  polygons: Array<[Vector2, Vector2, Vector2]>,
  boxMin: Vector2,
  boxMax: Vector2
): boolean {
  if (polygons.length === 0) {
    return false
  }

  // Binary tree pattern: check middle, then divide
  function checkRange(start: number, end: number): boolean {
    if (start >= end) {
      return false
    }

    const mid = Math.floor((start + end) / 2)

    // Check middle polygon
    if (doesTriangleIntersectBox(polygons[mid], boxMin, boxMax)) {
      return true
    }

    // Recursively check left and right halves
    if (checkRange(start, mid)) {
      return true
    }

    if (checkRange(mid + 1, end)) {
      return true
    }

    return false
  }

  return checkRange(0, polygons.length)
}

/**
 * Pure function: Determines if a segment intersects with the selection box
 * Uses improved logic:
 * 1. If segment bounding box is entirely inside selection box → intersects
 * 2. Else if bounding boxes intersect → check if any polygon intersects
 * 3. Else doesn't intersect
 */
export function doesSegmentIntersectSelectionBox(
  segmentBoundingBoxMin: Vector2,
  segmentBoundingBoxMax: Vector2,
  selectionBoxMin: Vector2,
  selectionBoxMax: Vector2,
  polygons: Array<[Vector2, Vector2, Vector2]>
): boolean {
  // Step 1: Check if segment bounding box is entirely inside selection box
  const segmentCorners = [
    new Vector2(segmentBoundingBoxMin.x, segmentBoundingBoxMin.y),
    new Vector2(segmentBoundingBoxMax.x, segmentBoundingBoxMin.y),
    new Vector2(segmentBoundingBoxMax.x, segmentBoundingBoxMax.y),
    new Vector2(segmentBoundingBoxMin.x, segmentBoundingBoxMax.y),
  ]

  const allCornersInside = areAllPointsContained(
    segmentCorners,
    selectionBoxMin,
    selectionBoxMax
  )

  if (allCornersInside) {
    return true
  }

  // Step 2: Check if bounding boxes intersect
  const boxesIntersect = doBoxesIntersect(
    segmentBoundingBoxMin,
    segmentBoundingBoxMax,
    selectionBoxMin,
    selectionBoxMax
  )

  if (!boxesIntersect) {
    return false
  }

  // Step 3: Check if any polygon intersects the selection box
  return doesAnyPolygonIntersectBox(polygons, selectionBoxMin, selectionBoxMax)
}
