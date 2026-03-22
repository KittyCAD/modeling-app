import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import { getAngleDiff } from '@src/lib/utils'
import {
  getArcPoints,
  getLinePoints,
  isArcSegment,
  isLineSegment,
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { htmlHelper } from '@src/machines/sketchSolve/segments'
import type { Coords2d } from '@src/lang/util'
import {
  Group,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
  Vector2,
} from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

export const AREA_SELECT_BORDER_WIDTH = 2
export const LINE_EXTENSION_SIZE = 12
const LABEL_VERTICAL_OFFSET = 12

export type SelectionBoxVisualState = {
  getSelectionBoxObject: () => CSS2DObject | null
  setSelectionBoxObject: (value: CSS2DObject | null) => void
  getSelectionBoxGroup: () => Group | null
  setSelectionBoxGroup: (value: Group | null) => void
  getLabelsWrapper: () => HTMLElement | null
  setLabelsWrapper: (value: HTMLElement | null) => void
  getBoxDiv: () => HTMLElement | null
  setBoxDiv: (value: HTMLElement | null) => void
  getVerticalLine: () => HTMLElement | null
  setVerticalLine: (value: HTMLElement | null) => void
  getHorizontalLine: () => HTMLElement | null
  setHorizontalLine: (value: HTMLElement | null) => void
}

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

function createSelectionBoxElements(borderStyle: 'dashed' | 'solid'): {
  boxDiv: HTMLElement
  verticalLine: HTMLElement
  horizontalLine: HTMLElement
  labelsWrapper: HTMLElement
} {
  const borderWidthPx = `${AREA_SELECT_BORDER_WIDTH}px`
  const [boxDiv, verticalLine, horizontalLine, labelsWrapper] = htmlHelper`
          <div
            ${{ key: 'id', value: 'selection-box' }}
            class = "border-bg-3 bg-black/5 dark:bg-white/10"
            style="
              position: absolute;
              pointer-events: none;
              border-width: ${borderWidthPx};
              border-style: ${borderStyle};
              transform: translate(-50%, -50%);
              box-sizing: border-box;
            "
          >
            <div
              ${{ key: 'id', value: 'vertical-line' }}
              class="bg-3"
              style="
                position: absolute;
                pointer-events: none;
                width: ${borderWidthPx};
              "
            ></div>
            <div
              ${{ key: 'id', value: 'horizontal-line' }}
              class="bg-3"
              style="
                position: absolute;
                pointer-events: none;
                height: ${borderWidthPx};
              "
            ></div>
            <div
              ${{ key: 'id', value: 'labels-wrapper' }}
              style="
                position: absolute;
                pointer-events: none;
                white-space: nowrap;
                display: flex;
                gap: 0px;
                align-items: center;
              "
            >
              <div
                ${{ key: 'id', value: 'intersects-label' }}
                class="text-3 dark:text-3"
                style="
                  font-size: 11px;
                  user-select: none;
                  width: 100px;
                  padding: 6px;
                  margin: 0px;
                  text-align: right;
                "
              >Intersects</div>
              <div
                ${{ key: 'id', value: 'contains-label' }}
                class="text-3 dark:text-3"
                style="
                  font-size: 11px;
                  user-select: none;
                  width: 100px;
                  padding: 6px;
                  margin: 0px;
                "
              >Within</div>
            </div>
          </div>
        `

  return {
    boxDiv,
    verticalLine,
    horizontalLine,
    labelsWrapper,
  }
}

function updateSelectionBoxPosition(
  selectionBoxObject: CSS2DObject,
  localCenter: Vector3
): void {
  selectionBoxObject.position.copy(localCenter)
}

function updateSelectionBoxSizeAndBorder(
  boxDiv: HTMLElement,
  widthPx: number,
  heightPx: number,
  borderStyle: 'dashed' | 'solid'
): void {
  boxDiv.style.width = `${widthPx}px`
  boxDiv.style.height = `${heightPx}px`
  boxDiv.style.borderWidth = `${AREA_SELECT_BORDER_WIDTH}px`
  boxDiv.style.borderStyle = borderStyle
}

function updateLabelStylesInDom(
  labelsWrapper: HTMLElement,
  labelStyles: {
    intersectsLabel: { opacity: string; fontWeight: string }
    containsLabel: { opacity: string; fontWeight: string }
  }
): void {
  const intersectsLabel = labelsWrapper.children[0] as HTMLElement
  const containsLabel = labelsWrapper.children[1] as HTMLElement

  if (intersectsLabel && containsLabel) {
    intersectsLabel.style.opacity = labelStyles.intersectsLabel.opacity
    intersectsLabel.style.fontWeight = labelStyles.intersectsLabel.fontWeight
    containsLabel.style.opacity = labelStyles.containsLabel.opacity
    containsLabel.style.fontWeight = labelStyles.containsLabel.fontWeight
  }
}

function updateLabelPosition(
  labelsWrapper: HTMLElement,
  startX: number,
  finalOffsetY: number
): void {
  labelsWrapper.style.left = `calc(50% + ${startX}px)`
  labelsWrapper.style.top = `calc(50% + ${finalOffsetY}px)`
  labelsWrapper.style.transform = 'translate(-50%, -50%)'
}

function updateCornerLinePositions(
  verticalLine: HTMLElement,
  horizontalLine: HTMLElement,
  cornerLineStyles: {
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
  }
): void {
  verticalLine.style.top = ''
  verticalLine.style.right = ''
  verticalLine.style.bottom = ''
  verticalLine.style.left = ''

  verticalLine.style.height = cornerLineStyles.verticalLine.height
  if (cornerLineStyles.verticalLine.bottom !== undefined) {
    verticalLine.style.bottom = cornerLineStyles.verticalLine.bottom
  }
  if (cornerLineStyles.verticalLine.top !== undefined) {
    verticalLine.style.top = cornerLineStyles.verticalLine.top
  }
  if (cornerLineStyles.verticalLine.left !== undefined) {
    verticalLine.style.left = cornerLineStyles.verticalLine.left
  }
  if (cornerLineStyles.verticalLine.right !== undefined) {
    verticalLine.style.right = cornerLineStyles.verticalLine.right
  }

  horizontalLine.style.top = ''
  horizontalLine.style.right = ''
  horizontalLine.style.bottom = ''
  horizontalLine.style.left = ''

  horizontalLine.style.width = cornerLineStyles.horizontalLine.width
  if (cornerLineStyles.horizontalLine.left !== undefined) {
    horizontalLine.style.left = cornerLineStyles.horizontalLine.left
  }
  if (cornerLineStyles.horizontalLine.right !== undefined) {
    horizontalLine.style.right = cornerLineStyles.horizontalLine.right
  }
  if (cornerLineStyles.horizontalLine.top !== undefined) {
    horizontalLine.style.top = cornerLineStyles.horizontalLine.top
  }
  if (cornerLineStyles.horizontalLine.bottom !== undefined) {
    horizontalLine.style.bottom = cornerLineStyles.horizontalLine.bottom
  }
}

export function updateSelectionBox({
  startPoint3D,
  currentPoint3D,
  sceneInfra,
  selectionBoxState,
}: {
  startPoint3D: Vector3
  currentPoint3D: Vector3
  sceneInfra: SceneInfra
  selectionBoxState: SelectionBoxVisualState
}): void {
  const camera = sceneInfra.camControls.camera
  const renderer = sceneInfra.renderer

  const viewportSize = new Vector2(
    renderer.domElement.clientWidth,
    renderer.domElement.clientHeight
  )

  const properties = calculateSelectionBoxProperties(
    startPoint3D,
    currentPoint3D,
    camera,
    viewportSize
  )

  const sketchSceneObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSceneGroup =
    sketchSceneObject instanceof Group ? sketchSceneObject : null

  if (!selectionBoxState.getSelectionBoxGroup()) {
    const newSelectionBoxGroup = new Group()
    newSelectionBoxGroup.name = 'selectionBox'
    newSelectionBoxGroup.userData.type = 'selectionBox'
    selectionBoxState.setSelectionBoxGroup(newSelectionBoxGroup)

    const elements = createSelectionBoxElements(properties.borderStyle)
    selectionBoxState.setBoxDiv(elements.boxDiv)
    selectionBoxState.setVerticalLine(elements.verticalLine)
    selectionBoxState.setHorizontalLine(elements.horizontalLine)
    selectionBoxState.setLabelsWrapper(elements.labelsWrapper)

    const newSelectionBoxObject = new CSS2DObject(elements.boxDiv)
    newSelectionBoxObject.userData.type = 'selectionBox'
    selectionBoxState.setSelectionBoxObject(newSelectionBoxObject)
    selectionBoxState.getSelectionBoxGroup()?.add(newSelectionBoxObject)

    if (sketchSceneGroup) {
      sketchSceneGroup.add(selectionBoxState.getSelectionBoxGroup()!)
      selectionBoxState.getSelectionBoxGroup()!.layers.set(SKETCH_LAYER)
      newSelectionBoxObject.layers.set(SKETCH_LAYER)
    }
  }

  const currentSelectionBoxObject = selectionBoxState.getSelectionBoxObject()
  if (
    currentSelectionBoxObject &&
    currentSelectionBoxObject.element instanceof HTMLElement
  ) {
    const localCenter = transformToLocalSpace(
      properties.center3D,
      sketchSceneGroup
    )
    updateSelectionBoxPosition(currentSelectionBoxObject, localCenter)

    const boxDivElement = selectionBoxState.getBoxDiv()
    if (boxDivElement) {
      updateSelectionBoxSizeAndBorder(
        boxDivElement,
        properties.widthPx,
        properties.heightPx,
        properties.borderStyle
      )
    }

    const labelPositioning = calculateLabelPositioning(
      properties.startPx,
      properties.boxMinPx,
      properties.boxMaxPx,
      properties.isDraggingUpward
    )

    const labelStyles = calculateLabelStyles(properties.isIntersectionBox)
    const currentLabelsWrapper = selectionBoxState.getLabelsWrapper()
    if (currentLabelsWrapper) {
      updateLabelStylesInDom(currentLabelsWrapper, labelStyles)
      updateLabelPosition(
        currentLabelsWrapper,
        labelPositioning.startX,
        labelPositioning.finalOffsetY
      )
    }

    const cornerLineStyles = calculateCornerLineStyles(
      labelPositioning.startX,
      labelPositioning.startY,
      LINE_EXTENSION_SIZE,
      AREA_SELECT_BORDER_WIDTH
    )

    const currentVerticalLine = selectionBoxState.getVerticalLine()
    const currentHorizontalLine = selectionBoxState.getHorizontalLine()
    if (
      currentVerticalLine &&
      currentVerticalLine instanceof HTMLElement &&
      currentHorizontalLine &&
      currentHorizontalLine instanceof HTMLElement
    ) {
      updateCornerLinePositions(
        currentVerticalLine,
        currentHorizontalLine,
        cornerLineStyles
      )
    }
  }
}

export function removeSelectionBox(
  selectionBoxState: SelectionBoxVisualState
): void {
  const currentSelectionBoxGroup = selectionBoxState.getSelectionBoxGroup()
  if (currentSelectionBoxGroup) {
    currentSelectionBoxGroup.removeFromParent()
    const currentSelectionBoxObject = selectionBoxState.getSelectionBoxObject()
    if (currentSelectionBoxObject?.element instanceof HTMLElement) {
      currentSelectionBoxObject.element.remove()
    }
    selectionBoxState.setSelectionBoxGroup(null)
    selectionBoxState.setSelectionBoxObject(null)
    selectionBoxState.setLabelsWrapper(null)
    selectionBoxState.setBoxDiv(null)
    selectionBoxState.setVerticalLine(null)
    selectionBoxState.setHorizontalLine(null)
  }
}

function getContainedArcPoints(
  center: Coords2d,
  start: Coords2d,
  end: Coords2d
): Coords2d[] {
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  if (radius === 0) {
    return [start, end]
  }

  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])
  const sweepAngle = getAngleDiff(startAngle, endAngle, true)
  const candidateAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  const extremaPoints = candidateAngles
    .filter((angle) => getAngleDiff(startAngle, angle, true) <= sweepAngle)
    .map(
      (angle) =>
        [
          center[0] + Math.cos(angle) * radius,
          center[1] + Math.sin(angle) * radius,
        ] as Coords2d
    )

  return [start, end, ...extremaPoints]
}

function doesArcIntersectBox(
  center: Coords2d,
  start: Coords2d,
  end: Coords2d,
  boxMin: Coords2d,
  boxMax: Coords2d
): boolean {
  if (
    isPointInBox(start, boxMin, boxMax) ||
    isPointInBox(end, boxMin, boxMax)
  ) {
    return true
  }

  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  if (radius === 0) {
    return false
  }

  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])
  const sweepAngle = getAngleDiff(startAngle, endAngle, true)
  const epsilon = 1e-9

  const isPointOnArc = (x: number, y: number): boolean => {
    if (
      x < boxMin[0] - epsilon ||
      x > boxMax[0] + epsilon ||
      y < boxMin[1] - epsilon ||
      y > boxMax[1] + epsilon
    ) {
      return false
    }

    const angle = Math.atan2(y - center[1], x - center[0])
    return getAngleDiff(startAngle, angle, true) <= sweepAngle + epsilon
  }

  for (const x of [boxMin[0], boxMax[0]]) {
    const dx = x - center[0]
    const offsetSquared = radius * radius - dx * dx
    if (offsetSquared < 0) {
      continue
    }

    const offset = Math.sqrt(Math.max(0, offsetSquared))
    if (
      isPointOnArc(x, center[1] + offset) ||
      isPointOnArc(x, center[1] - offset)
    ) {
      return true
    }
  }

  for (const y of [boxMin[1], boxMax[1]]) {
    const dy = y - center[1]
    const offsetSquared = radius * radius - dy * dy
    if (offsetSquared < 0) {
      continue
    }

    const offset = Math.sqrt(Math.max(0, offsetSquared))
    if (
      isPointOnArc(center[0] + offset, y) ||
      isPointOnArc(center[0] - offset, y)
    ) {
      return true
    }
  }

  return false
}

export function findContainedSegments(
  objects: Array<ApiObject>,
  startPoint: Coords2d,
  currentPoint: Coords2d
): Array<number> {
  if (objects.length === 0) {
    return []
  }

  const boxMin: Coords2d = [
    Math.min(startPoint[0], currentPoint[0]),
    Math.min(startPoint[1], currentPoint[1]),
  ]
  const boxMax: Coords2d = [
    Math.max(startPoint[0], currentPoint[0]),
    Math.max(startPoint[1], currentPoint[1]),
  ]
  const containedIds: Array<number> = []
  objects.forEach((apiObject) => {
    if (!apiObject) {
      return
    }

    if (isPointSegment(apiObject)) {
      if (
        apiObject.kind.segment.owner !== null &&
        apiObject.kind.segment.owner !== undefined
      ) {
        return
      }

      if (isPointInBox(pointToCoords2d(apiObject), boxMin, boxMax)) {
        containedIds.push(apiObject.id)
      }
      return
    }

    if (isLineSegment(apiObject)) {
      const linePoints = getLinePoints(apiObject, objects)
      if (
        linePoints &&
        linePoints.every((point) => isPointInBox(point, boxMin, boxMax))
      ) {
        containedIds.push(apiObject.id)
      }
      return
    }

    if (isArcSegment(apiObject)) {
      const arcPoints = getArcPoints(apiObject, objects)
      if (
        arcPoints &&
        getContainedArcPoints(
          arcPoints.center,
          arcPoints.start,
          arcPoints.end
        ).every((point) => isPointInBox(point, boxMin, boxMax))
      ) {
        containedIds.push(apiObject.id)
      }
    }
  })

  return containedIds
}

export function findIntersectingSegments(
  objects: Array<ApiObject>,
  startPoint: Coords2d,
  currentPoint: Coords2d
): Array<number> {
  if (objects.length === 0) {
    return []
  }

  const boxMin: Coords2d = [
    Math.min(startPoint[0], currentPoint[0]),
    Math.min(startPoint[1], currentPoint[1]),
  ]
  const boxMax: Coords2d = [
    Math.max(startPoint[0], currentPoint[0]),
    Math.max(startPoint[1], currentPoint[1]),
  ]
  const intersectingIds: Array<number> = []
  objects.forEach((apiObject) => {
    if (!apiObject) {
      return
    }

    if (isPointSegment(apiObject)) {
      if (
        apiObject.kind.segment.owner !== null &&
        apiObject.kind.segment.owner !== undefined
      ) {
        return
      }

      if (isPointInBox(pointToCoords2d(apiObject), boxMin, boxMax)) {
        intersectingIds.push(apiObject.id)
      }
      return
    }

    if (isLineSegment(apiObject)) {
      const linePoints = getLinePoints(apiObject, objects)
      if (
        linePoints &&
        doesLineSegmentIntersectBox(
          linePoints[0],
          linePoints[1],
          boxMin,
          boxMax
        )
      ) {
        intersectingIds.push(apiObject.id)
      }
      return
    }

    if (isArcSegment(apiObject)) {
      const arcPoints = getArcPoints(apiObject, objects)
      if (
        arcPoints &&
        doesArcIntersectBox(
          arcPoints.center,
          arcPoints.start,
          arcPoints.end,
          boxMin,
          boxMax
        )
      ) {
        intersectingIds.push(apiObject.id)
      }
    }
  })

  return intersectingIds
}
