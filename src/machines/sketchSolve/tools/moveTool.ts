import type {
  ApiObject,
  ExistingSegmentCtor,
  Expr,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'
import {
  htmlHelper,
  SEGMENT_TYPE_LINE,
  SEGMENT_TYPE_POINT,
  updateLineSegmentHover,
} from '@src/machines/sketchSolve/segments'
import {
  type Object3D,
  Box3,
  ExtrudeGeometry,
  Group,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
  Mesh,
  Vector2,
  BufferGeometry,
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
import { forceSuffix } from '@src/lang/util'

const AREA_SELECT_BORDER_WIDTH = 2
const LINE_EXTENSION_SIZE = 12
const LABEL_VERTICAL_OFFSET = 12

/**
 * Helper function to extract numeric value from an Expr.
 * Returns the value and units, or null if the Expr doesn't contain a numeric value.
 */
function extractNumericValue(
  expr: Expr
): { value: number; units: string } | null {
  if (expr.type === 'Number' || expr.type === 'Var') {
    return {
      value: expr.value,
      units: expr.units,
    }
  }
  return null
}

/**
 * Helper function to apply a drag vector to a Point2D Expr.
 * Returns a new Expr with the vector applied.
 */
function applyVectorToPoint2D(
  point: { x: Expr; y: Expr },
  vector: Vector2
): { x: Expr; y: Expr } {
  const xValue = extractNumericValue(point.x)
  const yValue = extractNumericValue(point.y)

  if (!xValue || !yValue) {
    // If we can't extract values, return original
    return point
  }

  return {
    x: {
      type: 'Var',
      value: roundOff(xValue.value + vector.x),
      units: forceSuffix(xValue.units),
    },
    y: {
      type: 'Var',
      value: roundOff(yValue.value + vector.y),
      units: forceSuffix(yValue.units),
    },
  }
}

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

      if (isPointSegment || isLineSegment) {
        return groupId
      }
    }
  }

  // If not found above, try getParentGroup (for three.js objects that aren't already Groups)
  const groupUnderCursor = getParentGroup(selected, [
    SEGMENT_TYPE_POINT,
    SEGMENT_TYPE_LINE,
  ])
  if (groupUnderCursor) {
    const groupId = Number(groupUnderCursor.name)
    return Number.isNaN(groupId) ? null : groupId
  }

  return null
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
 * Creates the onMouseEnter callback for sketch solve hover operations.
 * Handles highlighting line segments when the mouse enters them to provide visual feedback.
 *
 * @param updateLineSegmentHover - Function to update the hover state of a line segment
 * @param getSelectedIds - Function to get all selected IDs (selectedIds + duringAreaSelectIds)
 * @param setLastHoveredMesh - Function to store the currently hovered mesh
 * @returns The onMouseEnter callback function
 */
export function createOnMouseEnterCallback({
  updateLineSegmentHover,
  getSelectedIds,
  setLastHoveredMesh,
  getDraftEntityIds,
}: {
  updateLineSegmentHover: (
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

    // Only highlight line segment meshes (not point segments or other objects)
    const mesh = selected
    if (mesh.userData?.type === STRAIGHT_SEGMENT_BODY && mesh instanceof Mesh) {
      const allSelectedIds = getSelectedIds()
      const draftEntityIds = getDraftEntityIds?.()
      // Highlight the line segment to show it's interactive
      updateLineSegmentHover(mesh, true, allSelectedIds, draftEntityIds)
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
  updateLineSegmentHover,
  getSelectedIds,
  getLastHoveredMesh,
  setLastHoveredMesh,
  getDraftEntityIds,
}: {
  updateLineSegmentHover: (
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
      updateLineSegmentHover(hoveredMesh, false, allSelectedIds, draftEntityIds)
      setLastHoveredMesh(null)
    }

    // Also handle if selected is provided (for safety, in case the mesh wasn't tracked)
    if (selected) {
      const mesh = selected
      if (
        mesh.userData?.type === STRAIGHT_SEGMENT_BODY &&
        mesh instanceof Mesh
      ) {
        const allSelectedIds = getSelectedIds()
        const draftEntityIds = getDraftEntityIds?.()
        // Ensure hover is cleared even if the mesh wasn't in our tracking
        updateLineSegmentHover(mesh, false, allSelectedIds, draftEntityIds)
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

    setIsSolveInProgress(false)
    // After successful drag, update the lastSuccessfulDragFromPoint
    // This ensures the next drag calculates from the correct starting point
    setLastSuccessfulDragFromPoint(twoD.clone())

    // Notify about new sketch outcome if edit was successful
    if (result) {
      onNewSketchOutcome(result)
    }
  }
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
        self.send({ type: 'update sketch outcome', data: outcome }),
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
      updateLineSegmentHover,
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
      updateLineSegmentHover,
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
