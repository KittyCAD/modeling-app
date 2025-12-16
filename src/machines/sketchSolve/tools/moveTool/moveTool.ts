import type {
  ApiObject,
  ExistingSegmentCtor,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'
import {
  htmlHelper,
  SEGMENT_TYPE_LINE,
  SEGMENT_TYPE_POINT,
  SEGMENT_TYPE_ARC,
  ARC_SEGMENT_BODY,
  updateSegmentHover,
} from '@src/machines/sketchSolve/segments'
import {
  type Object3D,
  Box3,
  ExtrudeGeometry,
  Group,
  Vector3,
  Mesh,
  Vector2,
} from 'three'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import { baseUnitToNumericSuffix, type NumericSuffix } from '@src/lang/wasm'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import {
  getParentGroup,
  STRAIGHT_SEGMENT_BODY,
} from '@src/clientSideScene/sceneConstants'
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
  areAllPointsContained,
  calculateBoxBounds,
  calculateCornerLineStyles,
  calculateLabelPositioning,
  calculateLabelStyles,
  calculateSelectionBoxProperties,
  doesSegmentIntersectSelectionBox,
  extractTrianglesFromMesh,
  isIntersectionSelectionMode,
  project3DToScreen,
  transformToLocalSpace,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'

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
 * Default implementation of findPointSegmentElement that queries the DOM.
 * This can be overridden in tests for better testability.
 */
function defaultFindPointSegmentElement(segmentId: number): HTMLElement | null {
  // Find the element with the matching segment_id
  const allElements = document.querySelectorAll('[data-segment_id]')
  for (const el of allElements) {
    if (
      el instanceof HTMLElement &&
      el.dataset.segment_id === String(segmentId)
    ) {
      return el
    }
  }
  return null
}

/**
 * Creates the onDragStart callback for sketch solve drag operations.
 * Handles initialization of drag state and point segment visual feedback.
 *
 * @param setLastSuccessfulDragFromPoint - Setter for the last successful drag start point
 * @param setDraggingPointElement - Setter for the currently dragging point element
 * @param getDraggingPointElement - Getter for the currently dragging point element
 * @param findPointSegmentElement - Function to find a point segment element by ID (defaults to DOM query)
 */
export function createOnDragStartCallback({
  setLastSuccessfulDragFromPoint,
  setDraggingPointElement,
  getDraggingPointElement,
  findPointSegmentElement = defaultFindPointSegmentElement,
}: {
  setLastSuccessfulDragFromPoint: (point: Vector2) => void
  setDraggingPointElement: (element: HTMLElement | null) => void
  getDraggingPointElement: () => HTMLElement | null
  findPointSegmentElement?: (segmentId: number) => HTMLElement | null
}): (arg: {
  intersectionPoint: { twoD: Vector2; threeD: Vector3 }
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<any>
}) => void | Promise<void> {
  return ({ intersectionPoint, selected }) => {
    // reset on drag start
    setLastSuccessfulDragFromPoint(intersectionPoint.twoD.clone())

    // Check if we're starting a drag on a point segment (CSS2DObject)
    // sceneInfra now sets selected to the parent Group for CSS2DObjects
    if (selected instanceof Group) {
      const segmentId = Number(selected.name)
      if (!Number.isNaN(segmentId)) {
        // Check if this is a point segment by looking for the CSS2DObject
        const hasCSS2DObject = selected.children.some(
          (child) => child.userData?.type === 'handle'
        )
        if (hasCSS2DObject) {
          setDraggingPointElement(findPointSegmentElement(segmentId))
          // Set opacity to indicate dragging
          const element = getDraggingPointElement()
          if (element) {
            const innerCircle = element.querySelector('div')
            if (innerCircle) {
              innerCircle.style.opacity = '0.7'
            }
          }
          return
        }
      }
    }
    setDraggingPointElement(null)
  }
}

/**
 * Creates the onDragEnd callback for sketch solve drag operations.
 * Restores visual feedback for point segments after dragging ends.
 *
 * @param getDraggingPointElement - Getter for the currently dragging point element
 * @param setDraggingPointElement - Setter to clear the dragging point element
 * @param findInnerCircle - Function to find the inner circle element within a point element (defaults to querying by data attribute)
 */
export function createOnDragEndCallback({
  getDraggingPointElement,
  setDraggingPointElement,
  findInnerCircle = (element: HTMLElement): HTMLElement | null => {
    const found = element.querySelector('[data-point-inner-circle="true"]')
    // querySelector returns Element | null, but we know it's an HTMLElement (a div)
    // Use type guard to narrow to HTMLElement
    if (found instanceof HTMLElement) {
      return found
    }
    return null
  },
}: {
  getDraggingPointElement: () => HTMLElement | null
  setDraggingPointElement: (element: HTMLElement | null) => void
  findInnerCircle?: (element: HTMLElement) => HTMLElement | null
}): (arg: {
  intersectionPoint: { twoD: Vector2; threeD: Vector3 }
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<any>
}) => void | Promise<void> {
  return () => {
    // Restore opacity for point segment if we were dragging one
    const element = getDraggingPointElement()
    if (element) {
      const innerCircle = findInnerCircle(element)
      if (innerCircle) {
        // Restore full opacity to indicate dragging has ended
        innerCircle.style.opacity = '1'
      }
    }
    // Always clear the dragging state, even if no element was being dragged
    // This ensures state is always clean after drag ends
    setDraggingPointElement(null)
  }
}

/**
 * Finds the segment ID of the entity under the cursor.
 * Handles both Group objects (from CSS2DObject parents) and regular three.js objects.
 *
 * @param selected - The selected object from the scene
 * @param getParentGroup - Function to find parent group for non-Group objects
 * @returns The segment ID if found, null otherwise
 */
export function findEntityUnderCursorId(
  selected: Object3D | undefined,
  getParentGroup: (object: Object3D, segmentTypes: string[]) => Group | null
): number | null {
  if (!selected) {
    return null
  }

  // Check if selected is already a Group with a numeric name (segment group)
  // This handles CSS2DObjects where sceneInfra sets selected to the parent Group
  if (selected instanceof Group) {
    const groupId = Number(selected.name)
    if (!Number.isNaN(groupId)) {
      // Check if it's a point or line segment by userData.type or by checking children
      const isPointSegment =
        selected.userData?.type === 'point' ||
        selected.children.some((child) => child.userData?.type === 'handle')
      const isLineSegment =
        selected.userData?.type === SEGMENT_TYPE_LINE ||
        selected.children.some(
          (child) => child.userData?.type === STRAIGHT_SEGMENT_BODY
        )
      const isArcSegment =
        selected.userData?.type === SEGMENT_TYPE_ARC ||
        selected.children.some(
          (child) => child.userData?.type === ARC_SEGMENT_BODY
        )

      if (isPointSegment || isLineSegment || isArcSegment) {
        return groupId
      }
    }
  }

  // If not found above, try getParentGroup (for three.js objects that aren't already Groups)
  const groupUnderCursor = getParentGroup(selected, [
    SEGMENT_TYPE_POINT,
    SEGMENT_TYPE_LINE,
    SEGMENT_TYPE_ARC,
  ])
  if (groupUnderCursor) {
    const groupId = Number(groupUnderCursor.name)
    return Number.isNaN(groupId) ? null : groupId
  }

  return null
}

/**
 * Creates the onMouseEnter callback for sketch solve hover operations.
 * Handles highlighting line segments when the mouse enters them to provide visual feedback.
 *
 * @param updateLineSegmentHover - Function to update the hover state of a line segment
 * @param getSelectedIds - Function to get all selected IDs (selectedIds + duringAreaSelectIds)
 * @param setLastHoveredMesh - Function to store the currently hovered mesh
 * @returns The onMouseEnter callback function
 */
export function createOnMouseEnterCallback({
  updateSegmentHover,
  getSelectedIds,
  setLastHoveredMesh,
  getDraftEntityIds,
}: {
  updateSegmentHover: (
    mesh: Mesh,
    isHovering: boolean,
    selectedIds: Array<number>,
    draftEntityIds?: Array<number>
  ) => void
  getSelectedIds: () => Array<number>
  setLastHoveredMesh: (mesh: Mesh | null) => void
  getDraftEntityIds?: () => Array<number> | undefined
}): (arg: {
  selected?: Object3D
  isAreaSelectActive?: boolean
  mouseEvent: MouseEvent
  intersectionPoint?: Partial<{ twoD: Vector2; threeD: Vector3 }>
}) => void {
  return ({ selected, isAreaSelectActive }) => {
    // Disable hover highlighting during area select to avoid visual conflicts
    if (isAreaSelectActive) {
      return
    }
    if (!selected) return

    // Only highlight segment meshes (lines or arcs), not points or other objects
    const mesh = selected
    if (
      mesh instanceof Mesh &&
      (mesh.userData?.type === STRAIGHT_SEGMENT_BODY ||
        mesh.userData?.type === ARC_SEGMENT_BODY)
    ) {
      const allSelectedIds = getSelectedIds()
      const draftEntityIds = getDraftEntityIds?.()
      // Highlight the line segment to show it's interactive
      updateSegmentHover(mesh, true, allSelectedIds, draftEntityIds)
      // Store the hovered mesh so we can clear it on mouse leave
      setLastHoveredMesh(mesh)
    }
  }
}

/**
 * Creates the onMouseLeave callback for sketch solve hover operations.
 * Handles clearing hover highlighting when the mouse leaves line segments.
 *
 * @param updateLineSegmentHover - Function to update the hover state of a line segment
 * @param getSelectedIds - Function to get all selected IDs (selectedIds + duringAreaSelectIds)
 * @param getLastHoveredMesh - Function to get the previously hovered mesh
 * @param setLastHoveredMesh - Function to clear the stored hovered mesh
 * @returns The onMouseLeave callback function
 */
export function createOnMouseLeaveCallback({
  updateSegmentHover,
  getSelectedIds,
  getLastHoveredMesh,
  setLastHoveredMesh,
  getDraftEntityIds,
}: {
  updateSegmentHover: (
    mesh: Mesh,
    isHovering: boolean,
    selectedIds: Array<number>,
    draftEntityIds?: Array<number>
  ) => void
  getSelectedIds: () => Array<number>
  getLastHoveredMesh: () => Mesh | null
  setLastHoveredMesh: (mesh: Mesh | null) => void
  getDraftEntityIds?: () => Array<number> | undefined
}): (arg: {
  selected?: Object3D
  isAreaSelectActive?: boolean
  mouseEvent: MouseEvent
  intersectionPoint?: Partial<{ twoD: Vector2; threeD: Vector3 }>
}) => void {
  return ({ selected, isAreaSelectActive }) => {
    // Disable hover highlighting during area select to avoid visual conflicts
    if (isAreaSelectActive) {
      return
    }

    // Clear hover state for the previously hovered mesh
    const hoveredMesh = getLastHoveredMesh()
    if (hoveredMesh) {
      const allSelectedIds = getSelectedIds()
      const draftEntityIds = getDraftEntityIds?.()
      // Remove hover highlighting from the previously hovered segment
      updateSegmentHover(hoveredMesh, false, allSelectedIds, draftEntityIds)
      setLastHoveredMesh(null)
    }

    // Also handle if selected is provided (for safety, in case the mesh wasn't tracked)
    if (selected) {
      const mesh = selected
      if (
        mesh instanceof Mesh &&
        (mesh.userData?.type === STRAIGHT_SEGMENT_BODY ||
          mesh.userData?.type === ARC_SEGMENT_BODY)
      ) {
        const allSelectedIds = getSelectedIds()
        const draftEntityIds = getDraftEntityIds?.()
        // Ensure hover is cleared even if the mesh wasn't in our tracking
        updateSegmentHover(mesh, false, allSelectedIds, draftEntityIds)
      }
    }
  }
}

/**
 * Creates the onClick callback for sketch solve click operations.
 * Handles selecting segments when clicked and clearing selection when clicking on empty space.
 *
 * @param getParentGroup - Function to find parent group for non-Group objects
 * @param onUpdateSelectedIds - Function to update the selected IDs in the state machine
 * @returns The onClick callback function
 */
export function createOnClickCallback({
  getParentGroup,
  onUpdateSelectedIds,
}: {
  getParentGroup: (object: Object3D, segmentTypes: string[]) => Group | null
  onUpdateSelectedIds: (data: {
    selectedIds: Array<number>
    duringAreaSelectIds: Array<number>
  }) => void
}): (arg: {
  selected?: Object3D
  mouseEvent: MouseEvent
  intersectionPoint?: { twoD: Vector2; threeD: Vector3 }
  intersects: Array<unknown>
}) => Promise<void> {
  return async ({ selected }) => {
    // Find the segment group under the cursor using the same logic as drag operations
    const entityUnderCursorId = findEntityUnderCursorId(
      selected,
      getParentGroup
    )

    if (entityUnderCursorId !== null) {
      // Segment found - select it and clear any area selection
      onUpdateSelectedIds({
        selectedIds: [entityUnderCursorId],
        duringAreaSelectIds: [],
      })
      return
    }

    // No segment found - clicked on blank space, clear selection
    // sceneInfra should have detected CSS2DObjects in onMouseDown, so if we get here
    // with no group, it means we clicked on nothing
    onUpdateSelectedIds({
      selectedIds: [],
      duringAreaSelectIds: [],
    })
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
  return async ({ selected, intersectionPoint }) => {
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

    // Find the entity under cursor to determine what's being dragged
    const entityUnderCursorId = findEntityUnderCursorId(
      selected,
      getParentGroup
    )

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
  const [getLastHoveredMesh, setLastHoveredMesh] = createGetSet<Mesh | null>(
    null
  )
  const [getLastSuccessfulDragFromPoint, setLastSuccessfulDragFromPoint] =
    createGetSet<Vector2>(new Vector2())
  const [getDraggingPointElement, setDraggingPointElement] =
    createGetSet<HTMLElement | null>(null)

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
              style="
                position: absolute;
                pointer-events: none;
                border: ${borderWidthPx} ${borderStyle} rgba(255, 255, 255, 0.5);
                background-color: rgba(255, 255, 255, 0.1);
                transform: translate(-50%, -50%);
                box-sizing: border-box;
              "
            >
              <div
                ${{ key: 'id', value: 'vertical-line' }}
                style="
                  position: absolute;
                  pointer-events: none;
                  background-color: rgba(255, 255, 255, 0.5);
                  width: ${borderWidthPx};
                "
              ></div>
              <div
                ${{ key: 'id', value: 'horizontal-line' }}
                style="
                  position: absolute;
                  pointer-events: none;
                  background-color: rgba(255, 255, 255, 0.5);
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
                  style="
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.7);
                    user-select: none;
                    width: 100px;
                    padding: 6px;
                    margin: 0px;
                    text-align: right;
                  "
                >Intersects</div>
                <div
                  ${{ key: 'id', value: 'contains-label' }}
                  style="
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.7);
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
    boxDiv.style.border = `${AREA_SELECT_BORDER_WIDTH}px ${borderStyle} rgba(255, 255, 255, 0.5)`
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

  /**
   * Helper function to check if a point segment (CSS2DObject) is within the selection box
   * Returns the segment ID if it should be included, null otherwise
   */
  function checkPointSegmentInBox(
    css2dObject: CSS2DObject,
    segmentId: number,
    objects: Array<any>,
    camera: any,
    renderer: any,
    boxMinPx: Vector2,
    boxMaxPx: Vector2
  ): number | null {
    // Handle point segment - check if it has an owner (line endpoint)
    const obj = objects[segmentId]
    if (obj?.kind?.type === 'Segment' && obj.kind.segment.type === 'Point') {
      // Skip if point has an owner (it's a line endpoint)
      // Maybe we can enable these selection with a key modifier in the future
      if (
        obj.kind.segment.owner !== null &&
        obj.kind.segment.owner !== undefined
      ) {
        return null
      }

      // Get the world position of the CSS2DObject
      css2dObject.updateMatrixWorld()
      const worldPos = new Vector3()
      css2dObject.getWorldPosition(worldPos)

      // Project to screen space
      const viewportSize = new Vector2(
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight
      )
      const projected = worldPos.clone().project(camera)
      const screenPos = new Vector2(
        ((projected.x + 1) / 2) * viewportSize.x,
        ((1 - projected.y) / 2) * viewportSize.y
      )

      // Check if the point is within the selection box
      if (
        screenPos.x >= boxMinPx.x &&
        screenPos.x <= boxMaxPx.x &&
        screenPos.y >= boxMinPx.y &&
        screenPos.y <= boxMaxPx.y
      ) {
        return segmentId
      }
    }
    return null
  }

  /**
   * Helper function to find segments (line segments and point segments) contained within the selection box
   * Uses screen-space projection to check if segments are within the box
   */
  function findContainedSegments(
    boxMinPx: Vector2,
    boxMaxPx: Vector2
  ): Array<number> {
    const camera = context.sceneInfra.camControls.camera
    const renderer = context.sceneInfra.renderer
    const sketchSegments =
      context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
    if (!sketchSegments) {
      return []
    }

    // Get scene graph objects to check point ownership
    const snapshot = self.getSnapshot()
    const sceneGraphDelta = snapshot.context.sketchExecOutcome?.sceneGraphDelta
    const objects = sceneGraphDelta?.new_graph.objects
    if (!objects) {
      return []
    }

    const containedIds: Array<number> = []
    const viewportSize = new Vector2(
      renderer.domElement.clientWidth,
      renderer.domElement.clientHeight
    )

    // Traverse all groups in the sketch solve group
    sketchSegments.traverse((child: Object3D) => {
      if (!(child instanceof Group)) {
        return
      }

      const segmentId = Number(child.name)
      if (Number.isNaN(segmentId)) {
        return
      }

      // Check if this group has a line segment mesh
      const lineMesh = child.children.find(
        (c) => c instanceof Mesh && c.userData?.type === STRAIGHT_SEGMENT_BODY
      )

      if (lineMesh && lineMesh instanceof Mesh) {
        // Handle line segment
        const geometry = lineMesh.geometry
        if (!(geometry instanceof ExtrudeGeometry)) {
          return
        }

        // Get the bounding box of the mesh in world space
        lineMesh.updateMatrixWorld()
        const box = new Box3().setFromObject(lineMesh)

        // Get the 8 corners of the bounding box
        const min = box.min
        const max = box.max

        // Generate all 8 corners of the bounding box (already in world space)
        const corners = [
          new Vector3(min.x, min.y, min.z),
          new Vector3(max.x, min.y, min.z),
          new Vector3(min.x, max.y, min.z),
          new Vector3(max.x, max.y, min.z),
          new Vector3(min.x, min.y, max.z),
          new Vector3(max.x, min.y, max.z),
          new Vector3(min.x, max.y, max.z),
          new Vector3(max.x, max.y, max.z),
        ]

        // Project to screen space
        const screenCorners = corners.map((corner) => {
          const projected = corner.clone().project(camera)
          return new Vector2(
            ((projected.x + 1) / 2) * viewportSize.x,
            ((1 - projected.y) / 2) * viewportSize.y
          )
        })

        // For "contains" selection, check if ALL corners are within the selection box
        const allCornersContained = areAllPointsContained(
          screenCorners,
          boxMinPx,
          boxMaxPx
        )

        if (allCornersContained) {
          containedIds.push(segmentId)
        }
        return
      }

      // Check if this group has a CSS2DObject (point segment)
      const css2dObject = child.children.find(
        (c) => c instanceof CSS2DObject && c.userData?.type === 'handle'
      )

      if (css2dObject && css2dObject instanceof CSS2DObject) {
        const pointId = checkPointSegmentInBox(
          css2dObject,
          segmentId,
          objects,
          camera,
          renderer,
          boxMinPx,
          boxMaxPx
        )
        if (pointId !== null) {
          containedIds.push(pointId)
        }
      }
    })

    return containedIds
  }

  /**
   * Helper function to find segments (line segments and point segments) that intersect with the selection box
   * Uses improved intersection logic: checks bounding box containment first, then polygon intersection
   */
  function findIntersectingSegments(
    boxMinPx: Vector2,
    boxMaxPx: Vector2
  ): Array<number> {
    const camera = context.sceneInfra.camControls.camera
    const renderer = context.sceneInfra.renderer
    const sketchSegments =
      context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
    if (!sketchSegments) {
      return []
    }

    // Get scene graph objects to check point ownership
    const snapshot = self.getSnapshot()
    const sceneGraphDelta = snapshot.context.sketchExecOutcome?.sceneGraphDelta
    const objects = sceneGraphDelta?.new_graph.objects
    if (!objects) {
      return []
    }

    const intersectingIds: Array<number> = []
    const viewportSize = new Vector2(
      renderer.domElement.clientWidth,
      renderer.domElement.clientHeight
    )

    // Traverse all groups in the sketch solve group
    sketchSegments.traverse((child: Object3D) => {
      if (!(child instanceof Group)) {
        return
      }

      const segmentId = Number(child.name)
      if (Number.isNaN(segmentId)) {
        return
      }

      // Check if this group has a line segment mesh
      const lineMesh = child.children.find(
        (c) => c instanceof Mesh && c.userData?.type === STRAIGHT_SEGMENT_BODY
      )

      if (lineMesh && lineMesh instanceof Mesh) {
        // Handle line segment
        const geometry = lineMesh.geometry
        if (!(geometry instanceof ExtrudeGeometry)) {
          return
        }

        // Get the bounding box of the mesh in world space
        lineMesh.updateMatrixWorld()
        const box = new Box3().setFromObject(lineMesh)

        // Get the 8 corners of the bounding box
        const min = box.min
        const max = box.max

        // Generate all 8 corners of the bounding box (already in world space)
        const corners = [
          new Vector3(min.x, min.y, min.z),
          new Vector3(max.x, min.y, min.z),
          new Vector3(min.x, max.y, min.z),
          new Vector3(max.x, max.y, min.z),
          new Vector3(min.x, min.y, max.z),
          new Vector3(max.x, min.y, max.z),
          new Vector3(min.x, max.y, max.z),
          new Vector3(max.x, max.y, max.z),
        ]

        // Project to screen space
        const screenCorners = corners.map((corner) => {
          const projected = corner.clone().project(camera)
          return new Vector2(
            ((projected.x + 1) / 2) * viewportSize.x,
            ((1 - projected.y) / 2) * viewportSize.y
          )
        })

        // Compute the bounding box of the line segment in screen space
        const segmentMinPx = new Vector2(
          Math.min(...screenCorners.map((c) => c.x)),
          Math.min(...screenCorners.map((c) => c.y))
        )
        const segmentMaxPx = new Vector2(
          Math.max(...screenCorners.map((c) => c.x)),
          Math.max(...screenCorners.map((c) => c.y))
        )

        // Extract triangles from the mesh
        const triangles = extractTrianglesFromMesh(
          lineMesh,
          camera,
          viewportSize
        )

        // Use improved intersection logic
        const intersects = doesSegmentIntersectSelectionBox(
          segmentMinPx,
          segmentMaxPx,
          boxMinPx,
          boxMaxPx,
          triangles
        )

        if (intersects) {
          intersectingIds.push(segmentId)
        }
        return
      }

      // Check if this group has a CSS2DObject (point segment)
      const css2dObject = child.children.find(
        (c) => c instanceof CSS2DObject && c.userData?.type === 'handle'
      )

      if (css2dObject && css2dObject instanceof CSS2DObject) {
        const pointId = checkPointSegmentInBox(
          css2dObject,
          segmentId,
          objects,
          camera,
          renderer,
          boxMinPx,
          boxMaxPx
        )
        if (pointId !== null) {
          intersectingIds.push(pointId)
        }
      }
    })

    return intersectingIds
  }

  context.sceneInfra.setCallbacks({
    onDragStart: createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
    }),
    onDragEnd: createOnDragEndCallback({
      getDraggingPointElement,
      setDraggingPointElement,
    }),
    onDrag: createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
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
      onNewSketchOutcome: (outcome) =>
        self.send({
          type: 'update sketch outcome',
          data: { ...outcome, writeToDisk: false },
        }),
      getDefaultLengthUnit: () =>
        context.kclManager.fileSettings.defaultLengthUnit,
      getJsAppSettings: async () => await jsAppSettings(),
    }),
    onClick: createOnClickCallback({
      getParentGroup,
      onUpdateSelectedIds: (data: {
        selectedIds: Array<number>
        duringAreaSelectIds: Array<number>
      }) => self.send({ type: 'update selected ids', data }),
    }),
    onMouseEnter: createOnMouseEnterCallback({
      updateSegmentHover,
      getSelectedIds: () => {
        const snapshot = self.getSnapshot()
        // Combine selectedIds and duringAreaSelectIds for highlighting
        return Array.from(
          new Set([
            ...snapshot.context.selectedIds,
            ...snapshot.context.duringAreaSelectIds,
          ])
        )
      },
      setLastHoveredMesh,
      getDraftEntityIds: () => {
        const snapshot = self.getSnapshot()
        return snapshot.context.draftEntities
          ? [...snapshot.context.draftEntities.segmentIds]
          : undefined
      },
    }),
    onMouseLeave: createOnMouseLeaveCallback({
      updateSegmentHover,
      getSelectedIds: () => {
        const snapshot = self.getSnapshot()
        // Combine selectedIds and duringAreaSelectIds for highlighting
        return Array.from(
          new Set([
            ...snapshot.context.selectedIds,
            ...snapshot.context.duringAreaSelectIds,
          ])
        )
      },
      getLastHoveredMesh,
      setLastHoveredMesh,
      getDraftEntityIds: () => {
        const snapshot = self.getSnapshot()
        return snapshot.context.draftEntities
          ? [...snapshot.context.draftEntities.segmentIds]
          : undefined
      },
    }),
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

        const { min: boxMinPx, max: boxMaxPx } = calculateBoxBounds(
          startPx,
          currentPx
        )

        // Determine selection mode based on drag direction
        const isIntersectionBox = isIntersectionSelectionMode(
          startPx,
          currentPx
        )
        if (isIntersectionBox) {
          // Intersection box: find segments that intersect with the selection box
          const intersectingIds = findIntersectingSegments(boxMinPx, boxMaxPx)

          // Update duringAreaSelectIds (temporary selection during drag)
          self.send({
            type: 'update selected ids',
            data: { duringAreaSelectIds: intersectingIds },
          })
        } else {
          // Contains box: find segments fully contained within the selection box
          const containedIds = findContainedSegments(boxMinPx, boxMaxPx)

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
