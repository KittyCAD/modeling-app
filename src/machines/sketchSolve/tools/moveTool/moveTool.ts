import type {
  ApiObject,
  ExistingSegmentCtor,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { getAngleDiff, roundOff } from '@src/lib/utils'
import { htmlHelper } from '@src/machines/sketchSolve/segments'
import {
  type Object3D,
  type Vector3,
  Group,
  Vector2,
} from 'three'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import { baseUnitToNumericSuffix, type NumericSuffix } from '@src/lang/wasm'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { DeepPartial } from '@src/lib/types'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import {
  buildSegmentCtorFromObject,
  type SolveActionArgs,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { applyVectorToPoint2D } from '@src/lib/kclHelpers'
import {
  AREA_SELECT_BORDER_WIDTH,
  LINE_EXTENSION_SIZE,
  calculateCornerLineStyles,
  calculateLabelPositioning,
  calculateLabelStyles,
  calculateSelectionBoxProperties,
  doesLineSegmentIntersectBox,
  isIntersectionSelectionMode,
  project3DToScreen,
  transformToLocalSpace,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'
import {
  getArcPoints,
  getLinePoints,
  isConstraint,
  isArcSegment,
  isLineSegment,
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type {
  OnMoveCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import type { ClosestApiObject } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'

/**
 * Helper function to build a segment ctor with drag applied.
 * For the entity under cursor, uses twoD directly.
 * For other entities, applies twoDVec to their current positions.
 */
function buildSegmentCtorWithDrag({
  objUnderCursor: obj,
  selectedObjects: objects,
  isEntityUnderCursor,
  currentCursorPosition,
  dragVec,
  units,
}: {
  objUnderCursor: ApiObject
  selectedObjects: Array<ApiObject>
  isEntityUnderCursor: boolean
  currentCursorPosition: Vector2
  dragVec: Vector2
  units: NumericSuffix
}): SegmentCtor | null {
  const baseCtor = buildSegmentCtorFromObject(obj, objects)
  if (!baseCtor) {
    return null
  }

  if (baseCtor.type === 'Point') {
    if (isEntityUnderCursor) {
      // Use twoD directly for entity under cursor
      // Note: currentCursorPosition comes from intersectionPoint.twoD which is in world coordinates and scaled to match current units
      return {
        type: 'Point',
        position: {
          x: {
            type: 'Var',
            value: roundOff(currentCursorPosition.x),
            units,
          },
          y: {
            type: 'Var',
            value: roundOff(currentCursorPosition.y),
            units,
          },
        },
      }
    } else {
      // Apply drag vector to current position
      const currentPos = {
        x: baseCtor.position.x,
        y: baseCtor.position.y,
      }
      const newPos = applyVectorToPoint2D(currentPos, dragVec)
      return {
        type: 'Point',
        position: newPos,
      }
    }
  } else if (baseCtor.type === 'Line') {
    // For lines, always apply the drag vector to both endpoints (translate the line)
    // This applies whether it's the entity under cursor or another selected entity
    const newStart = applyVectorToPoint2D(baseCtor.start, dragVec)
    const newEnd = applyVectorToPoint2D(baseCtor.end, dragVec)
    return {
      type: 'Line',
      start: newStart,
      end: newEnd,
    }
  } else if (baseCtor.type === 'Arc') {
    // For arcs, always apply the drag vector to center, start, and end points (translate the arc)
    // This applies whether it's the entity under cursor or another selected entity
    const newCenter = applyVectorToPoint2D(baseCtor.center, dragVec)
    const newStart = applyVectorToPoint2D(baseCtor.start, dragVec)
    const newEnd = applyVectorToPoint2D(baseCtor.end, dragVec)

    // When dragging the arc body (all points translate), we don't need to swap start/end
    // All points move together, so the relative positions stay the same

    return {
      type: 'Arc',
      center: newCenter,
      start: newStart,
      end: newEnd,
    }
  }

  return baseCtor
}

/**
 * Creates the onDragStart callback for sketch solve drag operations.
 * Handles initialization of drag state.
 *
 * @param setLastSuccessfulDragFromPoint - Setter for the last successful drag start point
 */
export function createOnDragStartCallback({
  setLastSuccessfulDragFromPoint,
  setDraggedEntityId,
  getHoveredId,
}: {
  setLastSuccessfulDragFromPoint: (point: Vector2) => void
  setDraggedEntityId: (entityId: number | null) => void
  getHoveredId: () => number | null
}): (arg: {
  intersectionPoint: { twoD: Vector2; threeD: Vector3 }
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<any>
}) => void | Promise<void> {
  return ({ intersectionPoint }) => {
    setLastSuccessfulDragFromPoint(intersectionPoint.twoD.clone())
    setDraggedEntityId(getHoveredId())
  }
}

/**
 * Creates the onDragEnd callback for sketch solve drag operations.
 */
export function createOnDragEndCallback({
  setDraggedEntityId,
}: {
  setDraggedEntityId: (entityId: number | null) => void
}): (arg: {
  intersectionPoint?: Partial<{ twoD: Vector2; threeD: Vector3 }>
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<any>
}) => void | Promise<void> {
  return () => {
    setDraggedEntityId(null)
  }
}

/**
 * Creates the onClick callback for sketch solve click operations.
 * Handles selecting segments when clicked and clearing selection when clicking on empty space.
 *
 * @param onUpdateSelectedIds - Function to update the selected IDs in the state machine
 * @returns The onClick callback function
 */
export function createOnClickCallback({
  getApiObjects,
  sceneInfra,
  onUpdateSelectedIds,
  onEditConstraint,
}: {
  getApiObjects: () => ApiObject[]
  sceneInfra: SceneInfra
  onUpdateSelectedIds: (data: {
    selectedIds: Array<number>
    duringAreaSelectIds: Array<number>
  }) => void
  onEditConstraint: (constraintId: number) => void
}): (arg: {
  selected?: Object3D
  mouseEvent: MouseEvent
  intersectionPoint?: { twoD: Vector2; threeD: Vector3 }
  intersects: Array<unknown>
}) => Promise<void> {
  return async ({ mouseEvent, intersectionPoint }) => {
    let closestObject: ClosestApiObject | undefined

    if (intersectionPoint) {
      const mousePosition = [
        intersectionPoint.twoD.x,
        intersectionPoint.twoD.y,
      ] as Coords2d

      const closestObjects = findClosestApiObjects(
        mousePosition,
        getApiObjects(),
        sceneInfra
      )
      closestObject = closestObjects[0]
    }

    if (mouseEvent.detail === 2 && isConstraint(closestObject?.apiObject)) {
      // Double clicking on Constraint
      onEditConstraint(closestObject.apiObject.id)
    } else {
      onUpdateSelectedIds({
        selectedIds: closestObject ? [closestObject.apiObject.id] : [],
        duringAreaSelectIds: [],
      })
    }
  }
}

/**
 * Creates the onDrag callback for sketch solve drag operations.
 * Handles dragging segments by calculating drag vectors and updating segment positions.
 *
 * @param getIsSolveInProgress - Getter to check if a solve is already in progress
 * @param setIsSolveInProgress - Setter to mark solve as in progress/complete
 * @param getLastSuccessfulDragFromPoint - Getter for the last successful drag start point
 * @param setLastSuccessfulDragFromPoint - Setter to update the last successful drag start point
 * @param getDraggedEntityId - Getter for the entity captured at drag start
 * @param getContextData - Function to get the current context data (selectedIds, sketchId, sketchExecOutcome)
 * @param editSegments - Function to edit segments via Rust context
 * @param onNewSketchOutcome - Callback function called when a new sketch outcome is available
 * @param getDefaultLengthUnit - Function to get the default length unit for unit conversion
 * @param getJsAppSettings - Function to get app settings (async)
 */
export function createOnDragCallback({
  getIsSolveInProgress,
  setIsSolveInProgress,
  getLastSuccessfulDragFromPoint,
  setLastSuccessfulDragFromPoint,
  getDraggedEntityId,
  getContextData,
  editSegments,
  onNewSketchOutcome,
  getDefaultLengthUnit,
  getJsAppSettings,
}: {
  getIsSolveInProgress: () => boolean
  setIsSolveInProgress: (value: boolean) => void
  getLastSuccessfulDragFromPoint: () => Vector2
  setLastSuccessfulDragFromPoint: (point: Vector2) => void
  getDraggedEntityId: () => number | null
  getContextData: () => {
    selectedIds: Array<number>
    sketchId: number
    sketchExecOutcome?: {
      sceneGraphDelta: SceneGraphDelta
    }
  }
  editSegments: (
    version: number,
    sketchId: number,
    segments: Array<ExistingSegmentCtor>,
    settings: DeepPartial<Configuration>
  ) => Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  } | null>
  onNewSketchOutcome: (outcome: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    writeToDisk?: boolean
  }) => void
  getDefaultLengthUnit: () => UnitLength | undefined
  getJsAppSettings: () => Promise<DeepPartial<Configuration>>
}): (arg: {
  intersectionPoint: { twoD: Vector2; threeD: Vector3 }
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<unknown>
}) => Promise<void> {
  return async ({ intersectionPoint }) => {
    // Prevent concurrent drag operations
    if (getIsSolveInProgress()) {
      return
    }

    const contextData = getContextData()
    const selectedIds = contextData.selectedIds
    const sceneGraphDelta = contextData.sketchExecOutcome?.sceneGraphDelta

    if (!sceneGraphDelta) {
      return
    }

    const entityUnderCursorId = getDraggedEntityId()

    // If no entity under cursor and no selectedIds, nothing to do
    if (!entityUnderCursorId && selectedIds.length === 0) {
      return
    }

    setIsSolveInProgress(true)
    try {
      const twoD = intersectionPoint.twoD
      // Calculate drag vector from last successful drag point to current position
      const dragVec = twoD.clone().sub(getLastSuccessfulDragFromPoint())

      const objects = sceneGraphDelta.new_graph.objects
      const segmentsToEdit: ExistingSegmentCtor[] = []

      // Collect all IDs to edit (entity under cursor + selectedIds)
      const idsToEdit = new Set<number>()
      if (entityUnderCursorId !== null && !Number.isNaN(entityUnderCursorId)) {
        idsToEdit.add(entityUnderCursorId)
      }
      selectedIds.forEach((id) => {
        if (!Number.isNaN(id)) {
          idsToEdit.add(id)
        }
      })

      // Build ctors for each segment with drag applied
      const units = baseUnitToNumericSuffix(getDefaultLengthUnit())

      for (const id of idsToEdit) {
        const obj = objects[id]
        if (!obj) {
          continue
        }

        // Skip if not a segment
        if (obj.kind.type !== 'Segment') {
          continue
        }

        const isEntityUnderCursor = id === entityUnderCursorId

        const ctor = buildSegmentCtorWithDrag({
          objUnderCursor: obj,
          selectedObjects: objects,
          isEntityUnderCursor,
          currentCursorPosition: twoD,
          dragVec: dragVec,
          units,
        })

        if (ctor) {
          segmentsToEdit.push({ id, ctor })
        }
      }

      if (segmentsToEdit.length === 0) {
        setIsSolveInProgress(false)
        return
      }

      // Edit segments via Rust context
      const settings = await getJsAppSettings()
      // Get sketchId from context data (needed for editSegments)
      const sketchId = getContextData().sketchId
      const result = await editSegments(
        0,
        sketchId,
        segmentsToEdit,
        settings
      ).catch((err) => {
        console.error('failed to edit segment', err)
        return null
      })

      // After successful drag, update the lastSuccessfulDragFromPoint
      // This ensures the next drag calculates from the correct starting point
      setLastSuccessfulDragFromPoint(twoD.clone())

      // Notify about new sketch outcome if edit was successful
      if (result) {
        onNewSketchOutcome({ ...result, writeToDisk: false })
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    } finally {
      setIsSolveInProgress(false)
    }
  }
}

export function setUpOnDragAndSelectionClickCallbacks({
  self,
  context,
}: SolveActionArgs): void {
  const createGetSet = <T>(initial: T): [() => T, (a: T) => void] => {
    let value: T = initial
    return [
      () => value,
      (newValue: T) => {
        value = newValue
      },
    ]
  }
  // Closure-scoped mutex to prevent concurrent async editSegment operations.
  // Not in XState context since it's purely an implementation detail for race condition prevention.
  const [getIsSolveInProgress, setIsSolveInProgress] = createGetSet(false)
  const [getLastSuccessfulDragFromPoint, setLastSuccessfulDragFromPoint] =
    createGetSet<Vector2>(new Vector2())
  const [getDraggedEntityId, setDraggedEntityId] = createGetSet<number | null>(
    null
  )

  // Selection box visual element
  const [getSelectionBoxObject, setSelectionBoxObject] =
    createGetSet<CSS2DObject | null>(null)
  const [getSelectionBoxGroup, setSelectionBoxGroup] =
    createGetSet<Group | null>(null)
  const [getLabelsWrapper, setLabelsWrapper] = createGetSet<HTMLElement | null>(
    null
  )
  const [getBoxDiv, setBoxDiv] = createGetSet<HTMLElement | null>(null)
  const [getVerticalLine, setVerticalLine] = createGetSet<HTMLElement | null>(
    null
  )
  const [getHorizontalLine, setHorizontalLine] =
    createGetSet<HTMLElement | null>(null)

  /**
   * Mutation function: Creates selection box DOM elements
   * Creates the initial HTML structure for the selection box visual
   */
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

  /**
   * Mutation function: Updates selection box position in 3D space
   * Positions the CSS2DObject at the calculated local space position
   */
  function updateSelectionBoxPosition(
    selectionBoxObject: CSS2DObject,
    localCenter: Vector3
  ): void {
    selectionBoxObject.position.copy(localCenter)
  }

  /**
   * Mutation function: Updates selection box size and border style
   * Sets the box dimensions and border appearance
   */
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

  /**
   * Mutation function: Updates label styles based on selection mode
   * Applies opacity and font weight to show which mode is active
   */
  function updateLabelStyles(
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

  /**
   * Mutation function: Updates label position
   * Positions labels at the drag start point relative to box center
   */
  function updateLabelPosition(
    labelsWrapper: HTMLElement,
    startX: number,
    finalOffsetY: number
  ): void {
    labelsWrapper.style.left = `calc(50% + ${startX}px)`
    labelsWrapper.style.top = `calc(50% + ${finalOffsetY}px)`
    labelsWrapper.style.transform = 'translate(-50%, -50%)'
  }

  /**
   * Mutation function: Updates corner line positions and styles
   * Positions and sizes the vertical and horizontal corner lines
   */
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
    // Reset vertical line positions
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

    // Reset horizontal line positions
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

  /**
   * Helper function to create or update the selection box visual
   * Uses 3D coordinates and projects to screen space for accurate sizing
   */
  function updateSelectionBox(
    startPoint3D: Vector3,
    currentPoint3D: Vector3
  ): void {
    const camera = context.sceneInfra.camControls.camera
    const renderer = context.sceneInfra.renderer

    const viewportSize = new Vector2(
      renderer.domElement.clientWidth,
      renderer.domElement.clientHeight
    )

    // Calculate all properties using pure functions
    const properties = calculateSelectionBoxProperties(
      startPoint3D,
      currentPoint3D,
      camera,
      viewportSize
    )

    const sketchSceneObject =
      context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
    const sketchSceneGroup =
      sketchSceneObject instanceof Group ? sketchSceneObject : null

    if (!getSelectionBoxGroup()) {
      // Create the selection box group and CSS2DObject
      const newSelectionBoxGroup = new Group()
      newSelectionBoxGroup.name = 'selectionBox'
      newSelectionBoxGroup.userData.type = 'selectionBox'
      setSelectionBoxGroup(newSelectionBoxGroup)

      // Create DOM elements using mutation function
      const elements = createSelectionBoxElements(properties.borderStyle)
      setBoxDiv(elements.boxDiv)
      setVerticalLine(elements.verticalLine)
      setHorizontalLine(elements.horizontalLine)
      setLabelsWrapper(elements.labelsWrapper)

      const newSelectionBoxObject = new CSS2DObject(elements.boxDiv)
      newSelectionBoxObject.userData.type = 'selectionBox'
      setSelectionBoxObject(newSelectionBoxObject)
      getSelectionBoxGroup()?.add(newSelectionBoxObject)

      // Add to sketch solve group (will inherit its rotation)
      if (sketchSceneGroup) {
        sketchSceneGroup.add(getSelectionBoxGroup()!)
        getSelectionBoxGroup()!.layers.set(SKETCH_LAYER)
        newSelectionBoxObject.layers.set(SKETCH_LAYER)
      }
    }

    const currentSelectionBoxObject = getSelectionBoxObject()
    if (
      currentSelectionBoxObject &&
      currentSelectionBoxObject.element instanceof HTMLElement
    ) {
      // Calculate local space position using pure function
      const localCenter = transformToLocalSpace(
        properties.center3D,
        sketchSceneGroup ?? null
      )
      updateSelectionBoxPosition(currentSelectionBoxObject, localCenter)

      // Update box size and border
      const boxDivElement = getBoxDiv()
      if (boxDivElement) {
        updateSelectionBoxSizeAndBorder(
          boxDivElement,
          properties.widthPx,
          properties.heightPx,
          properties.borderStyle
        )
      }

      // Calculate label positioning using pure function
      const labelPositioning = calculateLabelPositioning(
        properties.startPx,
        properties.boxMinPx,
        properties.boxMaxPx,
        properties.isDraggingUpward
      )

      // Update label styles using pure function
      const labelStyles = calculateLabelStyles(properties.isIntersectionBox)
      const currentLabelsWrapper = getLabelsWrapper()
      if (currentLabelsWrapper) {
        updateLabelStyles(currentLabelsWrapper, labelStyles)
        updateLabelPosition(
          currentLabelsWrapper,
          labelPositioning.startX,
          labelPositioning.finalOffsetY
        )
      }

      // Calculate corner line styles using pure function
      const cornerLineStyles = calculateCornerLineStyles(
        labelPositioning.startX,
        labelPositioning.startY,
        LINE_EXTENSION_SIZE,
        AREA_SELECT_BORDER_WIDTH
      )

      // Update corner line positions
      const currentVerticalLine = getVerticalLine()
      const currentHorizontalLine = getHorizontalLine()
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

  /**
   * Helper function to remove the selection box visual
   */
  function removeSelectionBox(): void {
    const currentSelectionBoxGroup = getSelectionBoxGroup()
    if (currentSelectionBoxGroup) {
      currentSelectionBoxGroup.removeFromParent()
      const currentSelectionBoxObject = getSelectionBoxObject()
      if (currentSelectionBoxObject?.element instanceof HTMLElement) {
        currentSelectionBoxObject.element.remove()
      }
      setSelectionBoxGroup(null)
      setSelectionBoxObject(null)
      setLabelsWrapper(null)
    }
  }

  function isPointWithinBox(
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
      isPointWithinBox(start, boxMin, boxMax) ||
      isPointWithinBox(end, boxMin, boxMax)
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

  /**
   * Helper function to find segments contained within the selection box.
   * Uses API object geometry in sketch coordinates instead of scene meshes.
   */
  function findContainedSegments(
    startPoint: Coords2d,
    currentPoint: Coords2d
  ): Array<number> {
    const snapshot = self.getSnapshot()
    const sceneGraphDelta = snapshot.context.sketchExecOutcome?.sceneGraphDelta
    const objects = sceneGraphDelta?.new_graph.objects
    if (!objects) {
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

        if (isPointWithinBox(pointToCoords2d(apiObject), boxMin, boxMax)) {
          containedIds.push(apiObject.id)
        }
        return
      }

      if (isLineSegment(apiObject)) {
        const linePoints = getLinePoints(apiObject, objects)
        if (
          linePoints &&
          linePoints.every((point) => isPointWithinBox(point, boxMin, boxMax))
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
          ).every((point) => isPointWithinBox(point, boxMin, boxMax))
        ) {
          containedIds.push(apiObject.id)
        }
      }
    })

    return containedIds
  }

  /**
   * Helper function to find segments that intersect with the selection box.
   * Uses API object geometry in sketch coordinates instead of scene meshes.
   */
  function findIntersectingSegments(
    startPoint: Coords2d,
    currentPoint: Coords2d
  ): Array<number> {
    const snapshot = self.getSnapshot()
    const sceneGraphDelta = snapshot.context.sketchExecOutcome?.sceneGraphDelta
    const objects = sceneGraphDelta?.new_graph.objects
    if (!objects) {
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

        if (isPointWithinBox(pointToCoords2d(apiObject), boxMin, boxMax)) {
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

  context.sceneInfra.setCallbacks({
    onDragStart: createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggedEntityId,
      getHoveredId: () => self.getSnapshot().context.hoveredId,
    }),
    onDragEnd: createOnDragEndCallback({
      setDraggedEntityId,
    }),
    onDrag: createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData: () => {
        const snapshot = self.getSnapshot()
        return {
          selectedIds: snapshot.context.selectedIds,
          sketchId: snapshot.context.sketchId,
          sketchExecOutcome: snapshot.context.sketchExecOutcome,
        }
      },
      editSegments: async (
        version: number,
        sketchId: number,
        segments: Array<ExistingSegmentCtor>,
        settings: DeepPartial<Configuration>
      ) => {
        return context.rustContext.editSegments(
          version,
          sketchId,
          segments,
          settings
        )
      },
      onNewSketchOutcome: (outcome) => {
        self.send({
          type: 'update sketch outcome',
          data: {
            sourceDelta: outcome.kclSource,
            sceneGraphDelta: outcome.sceneGraphDelta,
            writeToDisk: false,
          },
        })
      },
      getDefaultLengthUnit: () =>
        context.kclManager.fileSettings.defaultLengthUnit,
      getJsAppSettings: async () =>
        jsAppSettings(context.rustContext.settingsActor),
    }),
    onMouseDownSelection: () => {
      return self.getSnapshot().context.hoveredId !== null
    },
    onClick: createOnClickCallback({
      getApiObjects: () =>
        self.getSnapshot().context.sketchExecOutcome?.sceneGraphDelta.new_graph
          .objects ?? [],
      sceneInfra: context.sceneInfra,
      onUpdateSelectedIds: (data: {
        selectedIds: Array<number>
        duringAreaSelectIds: Array<number>
      }) => self.send({ type: 'update selected ids', data }),
      onEditConstraint: (constraintId: number) => {
        self.send({
          type: 'start editing constraint',
          data: { constraintId },
        })
      },
    }),
    onMove: ({ intersectionPoint }: OnMoveCallbackArgs) => {
      if (context.sceneInfra.isAreaSelectActive) {
        return
      }

      const snapshot = self.getSnapshot()
      const mousePosition = [
        intersectionPoint.twoD.x,
        intersectionPoint.twoD.y,
      ] as Coords2d

      const apiObjects =
        snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ??
        []
      const closestObjects = findClosestApiObjects(
        mousePosition,
        apiObjects,
        context.sceneInfra
      )
      const hoveredObject: ClosestApiObject | null = closestObjects[0] ?? null
      const hoveredId = hoveredObject?.apiObject.id || null
      const lastHoveredId = snapshot.context.hoveredId

      if (hoveredId !== lastHoveredId) {
        self.send({ type: 'update hovered id', data: { hoveredId } })
      }
    },
    onAreaSelectStart: ({ startPoint }) => {
      const scaledStartPoint = startPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      // Area select started - create the selection box visual and clear any previous area select
      if (startPoint.threeD) {
        updateSelectionBox(scaledStartPoint, scaledStartPoint)
        // Clear any previous duringAreaSelectIds
        self.send({
          type: 'update selected ids',
          data: { duringAreaSelectIds: [] },
        })
      }
    },
    onAreaSelect: ({ startPoint, currentPoint }) => {
      const startCoords: Coords2d = [startPoint.twoD.x, startPoint.twoD.y]
      const currentCoords: Coords2d = [currentPoint.twoD.x, currentPoint.twoD.y]
      const scaledStartPoint = startPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      const scaledCurrentPoint = currentPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      // Update selection box visual during drag
      if (scaledStartPoint && scaledCurrentPoint) {
        updateSelectionBox(scaledStartPoint, scaledCurrentPoint)

        // Calculate selection box bounds in screen space for contains check
        const camera = context.sceneInfra.camControls.camera
        const renderer = context.sceneInfra.renderer
        const viewportSize = new Vector2(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight
        )

        const startPx = project3DToScreen(
          scaledStartPoint,
          camera,
          viewportSize
        )
        const currentPx = project3DToScreen(
          scaledCurrentPoint,
          camera,
          viewportSize
        )

        // Determine selection mode based on drag direction
        const isIntersectionBox = isIntersectionSelectionMode(
          startPx,
          currentPx
        )
        if (isIntersectionBox) {
          // Intersection box: find segments that intersect with the selection box
          const intersectingIds = findIntersectingSegments(
            startCoords,
            currentCoords
          )

          // Update duringAreaSelectIds (temporary selection during drag)
          self.send({
            type: 'update selected ids',
            data: { duringAreaSelectIds: intersectingIds },
          })
        } else {
          // Contains box: find segments fully contained within the selection box
          const containedIds = findContainedSegments(startCoords, currentCoords)

          // Update duringAreaSelectIds (temporary selection during drag)
          self.send({
            type: 'update selected ids',
            data: { duringAreaSelectIds: containedIds },
          })
        }
      }
    },
    onAreaSelectEnd: () => {
      // Remove selection box visual
      removeSelectionBox()

      // Merge duringAreaSelectIds into selectedIds and clear duringAreaSelectIds
      const snapshot = self.getSnapshot()
      const duringAreaSelectIds = snapshot.context.duringAreaSelectIds

      if (duringAreaSelectIds.length > 0) {
        // Merge duringAreaSelectIds into selectedIds
        const mergedIds = Array.from(
          new Set([...snapshot.context.selectedIds, ...duringAreaSelectIds])
        )
        self.send({
          type: 'update selected ids',
          data: { selectedIds: mergedIds, duringAreaSelectIds: [] },
        })
      } else {
        // Just clear duringAreaSelectIds
        self.send({
          type: 'update selected ids',
          data: { duringAreaSelectIds: [] },
        })
      }
    },
  })
}
