import {
  type Group,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
  Vector2,
} from 'three'
import type { Coords2d } from '@src/lang/util'

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
 * Pure function: Checks if a point is inside a 2D axis-aligned box
 */
function isPointInBox(
  point: Coords2d,
  boxMin: Coords2d,
  boxMax: Coords2d
): boolean {
  return (
    point[0] >= boxMin[0] &&
    point[0] <= boxMax[0] &&
    point[1] >= boxMin[1] &&
    point[1] <= boxMax[1]
  )
}

/**
 * Pure function: Checks if a line segment intersects with a 2D axis-aligned box
 * Uses Liang-Barsky algorithm for efficient line-box intersection
 */
export function doesLineSegmentIntersectBox(
  p0: Coords2d,
  p1: Coords2d,
  boxMin: Coords2d,
  boxMax: Coords2d
): boolean {
  // If either endpoint is inside the box, it intersects
  if (isPointInBox(p0, boxMin, boxMax) || isPointInBox(p1, boxMin, boxMax)) {
    return true
  }

  // Check if line segment intersects box edges
  // Use parametric line equation: P(t) = p0 + t * (p1 - p0), t in [0, 1]
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]

  // Check intersection with box edges
  // Left edge: x = boxMin.x
  if (dx !== 0) {
    const t = (boxMin[0] - p0[0]) / dx
    if (t >= 0 && t <= 1) {
      const y = p0[1] + t * dy
      if (y >= boxMin[1] && y <= boxMax[1]) {
        return true
      }
    }
  }

  // Right edge: x = boxMax.x
  if (dx !== 0) {
    const t = (boxMax[0] - p0[0]) / dx
    if (t >= 0 && t <= 1) {
      const y = p0[1] + t * dy
      if (y >= boxMin[1] && y <= boxMax[1]) {
        return true
      }
    }
  }

  // Top edge: y = boxMin.y
  if (dy !== 0) {
    const t = (boxMin[1] - p0[1]) / dy
    if (t >= 0 && t <= 1) {
      const x = p0[0] + t * dx
      if (x >= boxMin[0] && x <= boxMax[0]) {
        return true
      }
    }
  }

  // Bottom edge: y = boxMax.y
  if (dy !== 0) {
    const t = (boxMax[1] - p0[1]) / dy
    if (t >= 0 && t <= 1) {
      const x = p0[0] + t * dx
      if (x >= boxMin[0] && x <= boxMax[0]) {
        return true
      }
    }
  }

  return false
}
