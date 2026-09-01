import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { Themes, getResolvedTheme } from '@src/lib/theme'
import { isArray } from '@src/lib/utils'
import { TAU, getAngleDiff } from '@src/lib/utils2d'
import {
  getArcPoints,
  getLinePoints,
  isArcLikeSegment,
  isLineSegment,
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { htmlHelper } from '@src/machines/sketchSolve/segments'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector2,
  Vector3,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

export const AREA_SELECT_BORDER_WIDTH = 2
export const LINE_EXTENSION_SIZE = 12
const AREA_SELECT_DASH_SIZE_PX = 4
const AREA_SELECT_GAP_SIZE_PX = 3

export type SelectionBoxVisualState = {
  getSelectionBoxObject: () => CSS2DObject | null
  setSelectionBoxObject: (value: CSS2DObject | null) => void
  getSelectionBoxGroup: () => Group | null
  setSelectionBoxGroup: (value: Group | null) => void
  getLabelsWrapper: () => HTMLElement | null
  setLabelsWrapper: (value: HTMLElement | null) => void
}

const SELECTION_BOX_FILL = 'selectionBoxFill'
const SELECTION_BOX_OUTLINE = 'selectionBoxOutline'
const SELECTION_BOX_TAIL = 'selectionBoxTail'
const SELECTION_BOX_RENDER_ORDER = 101
const SELECTION_BOX_COLORS = {
  [Themes.Light]: 0xd9d9d9,
  [Themes.Dark]: 0x5e5e5e,
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

function createSelectionBoxElements(): {
  labelAnchor: HTMLElement
  labelsWrapper: HTMLElement
} {
  const [labelAnchor, labelsWrapper] = htmlHelper`
          <div ${{ key: 'id', value: 'selection-box' }} style="pointer-events: none;">
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
              ><span class="selection-box-label-backdrop">Intersects</span></div>
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
              ><span class="selection-box-label-backdrop">Within</span></div>
            </div>
          </div>
        `

  return {
    labelAnchor,
    labelsWrapper,
  }
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

export function calculateSelectionRectangleCorners(
  startPoint: Vector3,
  currentPoint: Vector3
): [Vector3, Vector3, Vector3, Vector3] {
  return [
    new Vector3(startPoint.x, startPoint.y, 0),
    new Vector3(currentPoint.x, startPoint.y, 0),
    new Vector3(currentPoint.x, currentPoint.y, 0),
    new Vector3(startPoint.x, currentPoint.y, 0),
  ]
}

export function calculateSelectionTailEndpoint(
  startPoint: Vector3,
  currentPoint: Vector3,
  projectedStart: Vector2,
  projectedStartEdgeEnd: Vector2
): Vector3 {
  const projectedEdgeLength = projectedStart.distanceTo(projectedStartEdgeEnd)
  if (projectedEdgeLength < 1e-6) {
    return startPoint.clone()
  }

  const localEdgeLength = Math.abs(currentPoint.y - startPoint.y)
  const tailLength =
    (localEdgeLength * LINE_EXTENSION_SIZE) / projectedEdgeLength
  const tailDirection = Math.sign(startPoint.y - currentPoint.y)

  return startPoint.clone().add(new Vector3(0, tailDirection * tailLength, 0))
}

export function calculateLocalUnitsPerScreenPixel(
  localCorners: [Vector3, Vector3, Vector3, Vector3],
  projectedCorners: [Vector2, Vector2, Vector2, Vector2]
): number {
  let localPerimeter = 0
  let projectedPerimeter = 0
  for (let index = 0; index < localCorners.length; index++) {
    const nextIndex = (index + 1) % localCorners.length
    localPerimeter += localCorners[index].distanceTo(localCorners[nextIndex])
    projectedPerimeter += projectedCorners[index].distanceTo(
      projectedCorners[nextIndex]
    )
  }

  return projectedPerimeter > 1e-6 ? localPerimeter / projectedPerimeter : 1
}

function updateSelectionBoxGeometry(
  group: Group,
  corners: [Vector3, Vector3, Vector3, Vector3],
  tailEndpoint: Vector3,
  isIntersectionBox: boolean,
  viewportSize: Vector2,
  localUnitsPerScreenPixel: number
): void {
  const positions = corners.flatMap((point) => [point.x, point.y, point.z])
  const outline = group.getObjectByName(SELECTION_BOX_OUTLINE)
  if (outline instanceof Line2) {
    outline.geometry.setPositions([...positions, ...positions.slice(0, 3)])
    outline.computeLineDistances()
    if (outline.material instanceof LineMaterial) {
      outline.material.dashed = isIntersectionBox
      outline.material.dashSize =
        AREA_SELECT_DASH_SIZE_PX * localUnitsPerScreenPixel
      outline.material.gapSize =
        AREA_SELECT_GAP_SIZE_PX * localUnitsPerScreenPixel
      outline.material.resolution.copy(viewportSize)
      outline.material.needsUpdate = true
    }
  }

  const tail = group.getObjectByName(SELECTION_BOX_TAIL)
  if (tail instanceof Line2) {
    tail.geometry.setPositions([
      corners[0].x,
      corners[0].y,
      corners[0].z,
      tailEndpoint.x,
      tailEndpoint.y,
      tailEndpoint.z,
    ])
    if (tail.material instanceof LineMaterial) {
      tail.material.resolution.copy(viewportSize)
    }
  }

  const fill = group.getObjectByName(SELECTION_BOX_FILL)
  if (fill instanceof Mesh && fill.geometry instanceof BufferGeometry) {
    fill.geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        [
          ...positions.slice(0, 9),
          ...positions.slice(0, 3),
          ...positions.slice(6, 12),
        ],
        3
      )
    )
    fill.geometry.computeBoundingSphere()
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

  const startPx = project3DToScreen(startPoint3D, camera, viewportSize)
  const currentPx = project3DToScreen(currentPoint3D, camera, viewportSize)
  const isIntersectionBox = isIntersectionSelectionMode(startPx, currentPx)

  const sketchSceneObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSceneGroup =
    sketchSceneObject instanceof Group ? sketchSceneObject : null

  if (!selectionBoxState.getSelectionBoxGroup()) {
    const newSelectionBoxGroup = new Group()
    newSelectionBoxGroup.name = 'selectionBox'
    newSelectionBoxGroup.userData.type = 'selectionBox'
    selectionBoxState.setSelectionBoxGroup(newSelectionBoxGroup)

    const resolvedTheme = getResolvedTheme(sceneInfra.theme) ?? Themes.Light
    const selectionBoxColor = SELECTION_BOX_COLORS[resolvedTheme]
    const fill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        color: resolvedTheme === Themes.Dark ? 0xffffff : 0x000000,
        transparent: true,
        opacity: resolvedTheme === Themes.Dark ? 0.1 : 0.05,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      })
    )
    fill.name = SELECTION_BOX_FILL
    fill.renderOrder = SELECTION_BOX_RENDER_ORDER
    const outline = new Line2(
      new LineGeometry(),
      new LineMaterial({
        color: selectionBoxColor,
        linewidth: AREA_SELECT_BORDER_WIDTH * window.devicePixelRatio,
        worldUnits: false,
        dashed: isIntersectionBox,
        dashSize: AREA_SELECT_DASH_SIZE_PX,
        gapSize: AREA_SELECT_GAP_SIZE_PX,
        depthTest: false,
        depthWrite: false,
        resolution: viewportSize,
      })
    )
    outline.name = SELECTION_BOX_OUTLINE
    outline.renderOrder = SELECTION_BOX_RENDER_ORDER + 1
    const tail = new Line2(
      new LineGeometry(),
      new LineMaterial({
        color: selectionBoxColor,
        linewidth: AREA_SELECT_BORDER_WIDTH * window.devicePixelRatio,
        worldUnits: false,
        depthTest: false,
        depthWrite: false,
        resolution: viewportSize,
      })
    )
    tail.name = SELECTION_BOX_TAIL
    tail.renderOrder = SELECTION_BOX_RENDER_ORDER + 1
    newSelectionBoxGroup.add(fill, outline, tail)
    newSelectionBoxGroup.traverse((child) => {
      child.layers.set(SKETCH_LAYER)
    })

    const elements = createSelectionBoxElements()
    selectionBoxState.setLabelsWrapper(elements.labelsWrapper)

    const newSelectionBoxObject = new CSS2DObject(elements.labelAnchor)
    newSelectionBoxObject.userData.type = 'selectionBox'
    selectionBoxState.setSelectionBoxObject(newSelectionBoxObject)
    selectionBoxState.getSelectionBoxGroup()?.add(newSelectionBoxObject)

    if (sketchSceneGroup) {
      sketchSceneGroup.add(newSelectionBoxGroup)
      newSelectionBoxGroup.layers.set(SKETCH_LAYER)
      newSelectionBoxObject.layers.set(SKETCH_LAYER)
    }
  }

  const currentSelectionBoxObject = selectionBoxState.getSelectionBoxObject()
  if (currentSelectionBoxObject?.element instanceof HTMLElement) {
    const localStart = transformToLocalSpace(startPoint3D, sketchSceneGroup)
    const localCurrent = transformToLocalSpace(currentPoint3D, sketchSceneGroup)
    const corners = calculateSelectionRectangleCorners(localStart, localCurrent)
    const worldCorners = corners.map((corner) => {
      const worldCorner = corner.clone()
      if (sketchSceneGroup) sketchSceneGroup.localToWorld(worldCorner)
      return worldCorner
    }) as [Vector3, Vector3, Vector3, Vector3]
    const projectedCorners = worldCorners.map((corner) =>
      project3DToScreen(corner, camera, viewportSize)
    ) as [Vector2, Vector2, Vector2, Vector2]
    const localUnitsPerScreenPixel = calculateLocalUnitsPerScreenPixel(
      corners,
      projectedCorners
    )
    const startEdgeEndWorld = corners[3].clone()
    if (sketchSceneGroup) {
      sketchSceneGroup.localToWorld(startEdgeEndWorld)
    }
    const projectedStartEdgeEnd = project3DToScreen(
      startEdgeEndWorld,
      camera,
      viewportSize
    )
    const tailEndpoint = calculateSelectionTailEndpoint(
      localStart,
      localCurrent,
      startPx,
      projectedStartEdgeEnd
    )
    const group = selectionBoxState.getSelectionBoxGroup()
    if (group) {
      updateSelectionBoxGeometry(
        group,
        corners,
        tailEndpoint,
        isIntersectionBox,
        viewportSize,
        localUnitsPerScreenPixel
      )
    }

    currentSelectionBoxObject.position.copy(tailEndpoint)

    const labelStyles = calculateLabelStyles(isIntersectionBox)
    const currentLabelsWrapper = selectionBoxState.getLabelsWrapper()
    if (currentLabelsWrapper) {
      updateLabelStylesInDom(currentLabelsWrapper, labelStyles)
      currentLabelsWrapper.style.transform = 'translate(-50%, -50%)'
    }
  }
}

export function removeSelectionBox(
  selectionBoxState: SelectionBoxVisualState
): void {
  const currentSelectionBoxGroup = selectionBoxState.getSelectionBoxGroup()
  if (currentSelectionBoxGroup) {
    currentSelectionBoxGroup.removeFromParent()
    currentSelectionBoxGroup.traverse((child) => {
      if (child instanceof Mesh || child instanceof Line2) {
        child.geometry.dispose()
        if (isArray(child.material)) {
          child.material.forEach((material) => {
            if (material instanceof Material) material.dispose()
          })
        } else {
          child.material.dispose()
        }
      }
    })
    const currentSelectionBoxObject = selectionBoxState.getSelectionBoxObject()
    if (currentSelectionBoxObject?.element instanceof HTMLElement) {
      currentSelectionBoxObject.element.remove()
    }
    selectionBoxState.setSelectionBoxGroup(null)
    selectionBoxState.setSelectionBoxObject(null)
    selectionBoxState.setLabelsWrapper(null)
  }
}

function getContainedArcPoints(
  center: Coords2d,
  start: Coords2d,
  end: Coords2d,
  isCircle = false
): Coords2d[] {
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  if (radius === 0) {
    return [start, end]
  }

  if (isCircle) {
    return [
      start,
      end,
      [center[0] + radius, center[1]],
      [center[0], center[1] + radius],
      [center[0] - radius, center[1]],
      [center[0], center[1] - radius],
    ]
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
  boxMax: Coords2d,
  isCircle = false
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
  const sweepAngle = isCircle ? TAU : getAngleDiff(startAngle, endAngle, true)
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

    if (isCircle) {
      return true
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

    if (isArcLikeSegment(apiObject)) {
      const arcPoints = getArcPoints(apiObject, objects)
      if (
        arcPoints &&
        getContainedArcPoints(
          arcPoints.center,
          arcPoints.start,
          arcPoints.end,
          arcPoints.isCircle
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

    if (isArcLikeSegment(apiObject)) {
      const arcPoints = getArcPoints(apiObject, objects)
      if (
        arcPoints &&
        doesArcIntersectBox(
          arcPoints.center,
          arcPoints.start,
          arcPoints.end,
          boxMin,
          boxMax,
          arcPoints.isCircle
        )
      ) {
        intersectingIds.push(apiObject.id)
      }
    }
  })

  return intersectingIds
}
