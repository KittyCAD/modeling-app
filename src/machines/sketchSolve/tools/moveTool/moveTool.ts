import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type {
  ApiObject,
  ExistingSegmentCtor,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type {
  OnMoveCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { type NumericSuffix, baseUnitToNumericSuffix } from '@src/lang/wasm'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { applyVectorToPoint2D } from '@src/lib/kclHelpers'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { DeepPartial } from '@src/lib/types'
import { isArray, roundOff } from '@src/lib/utils'
import { distance2d } from '@src/lib/utils2d'
import { isConstraintHoverPopup } from '@src/machines/sketchSolve/constraints/InvisibleConstraintSpriteBuilder'
import {
  getCoincidentCluster,
  isConstraint,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  type ConstraintHoverPopup,
  findInvisibleConstraintsForSegment,
  isConstrainingSegment,
  isInvisibleConstraintObject,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import {
  findClosestApiObjects,
  getSketchHoverDistance,
} from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
  type SolveActionArgs,
  buildSegmentCtorFromObject,
  getObjectSelectionIds,
  isObjectSelectionId,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  type SnappingCandidate,
  allowSnapping,
  getConstraintForSnapTarget,
  getSnappingCandidates,
  isPointSnapTarget,
} from '@src/machines/sketchSolve/snapping'
import { updateSnappingPreviewSprite } from '@src/machines/sketchSolve/snappingPreviewSprite'
import {
  type SelectionBoxVisualState,
  findContainedSegments,
  findIntersectingSegments,
  isIntersectionSelectionMode,
  project3DToScreen,
  removeSelectionBox,
  updateSelectionBox,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'
import { Group, type Object3D, Vector2, Vector3 } from 'three'
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

type ClosestSelectionTarget = {
  distance: number
  selectionId: SketchSolveSelectionId
  apiObject: ApiObject | null
}

function getClosestSelectionTarget(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): ClosestSelectionTarget | null {
  const closestObject = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  )[0]

  const selectionCandidates: ClosestSelectionTarget[] = []
  if (closestObject) {
    selectionCandidates.push({
      distance: closestObject.distance,
      selectionId: closestObject.apiObject.id,
      apiObject: closestObject.apiObject,
    })
  }

  const sketchSolveGroupObject =
    sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSolveGroup =
    sketchSolveGroupObject instanceof Group ? sketchSolveGroupObject : null
  const hoverDistance = getSketchHoverDistance(
    sceneInfra.getClientSceneScaleFactor(sketchSolveGroup)
  )
  const originDistance = distance2d(mousePosition, [0, 0])

  if (originDistance < hoverDistance) {
    selectionCandidates.push({
      distance: originDistance,
      selectionId: ORIGIN_TARGET,
      apiObject: null,
    })
  }

  selectionCandidates.sort((a, b) => {
    const priorityDelta = getSelectionPriority(a) - getSelectionPriority(b)
    if (priorityDelta !== 0) {
      return priorityDelta
    }
    return a.distance - b.distance
  })
  return selectionCandidates[0] ?? null
}

// Priorities are similar to snapping/getSnappingCandidates:
// - point like objects (point segment, origin) should take precedence
// However:
// - axes cannot be selected, but they can be snapped to
// - only points can be snapped to, other segment types cannot (for now)
function getSelectionPriority(selectionTarget: ClosestSelectionTarget) {
  if (isInvisibleConstraintObject(selectionTarget.apiObject)) {
    return 0
  }
  if (isPointSegment(selectionTarget.apiObject)) {
    return 1
  }
  if (selectionTarget.selectionId === 'origin') {
    return 2
  }

  return 3
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
  } else if (baseCtor.type === 'Circle') {
    const newCenter = applyVectorToPoint2D(baseCtor.center, dragVec)
    const newStart = applyVectorToPoint2D(baseCtor.start, dragVec)

    return {
      type: 'Circle',
      center: newCenter,
      start: newStart,
      construction: baseCtor.construction,
    }
  }

  return baseCtor
}

function getDragPointSnappingCandidate({
  draggedEntityId,
  selectedIds,
  sceneGraphDelta,
  sketchId,
  mousePosition,
  sceneInfra,
}: {
  draggedEntityId: number | null
  selectedIds: number[]
  sceneGraphDelta: SceneGraphDelta
  sketchId: number
  mousePosition: Coords2d
  sceneInfra: SceneInfra
}): SnappingCandidate | null {
  if (draggedEntityId === null) {
    return null
  }
  const draggedObject = sceneGraphDelta.new_graph.objects[draggedEntityId]
  if (!isPointSegment(draggedObject)) {
    // snapping only works with points for now
    return null
  }

  const selectedIdsWithoutOwner = selectedIds.filter(
    (selectedId) => selectedId !== draggedObject.kind.segment.owner
  )
  if (
    selectedIdsWithoutOwner.length >= 2 ||
    (selectedIdsWithoutOwner.length === 1 &&
      selectedIdsWithoutOwner[0] !== draggedEntityId)
  ) {
    // Drag snapping only supports a single dragged point, but allow the point's
    // owner segment to remain selected because arc/circle point drags often keep
    // the parent segment selected in the move tool.
    return null
  }

  const coincidentPointIds = getCoincidentCluster(
    draggedEntityId,
    sceneGraphDelta.new_graph.objects
  )

  const currentSketchObjects = getCurrentSketchObjectsById(
    sceneGraphDelta.new_graph.objects,
    sketchId
  )
  // Find the closest point to snap to which is not already in the same
  // coincident point cluster as the dragged point.
  const candidate =
    getSnappingCandidates(mousePosition, currentSketchObjects, sceneInfra).find(
      (candidate) =>
        !isPointSnapTarget(candidate.target) ||
        !coincidentPointIds.includes(candidate.target.pointId)
    ) ?? null

  return candidate
}

function hasCoincidentConstraintWithOrigin(
  pointId: number,
  objects: ApiObject[]
) {
  return objects.some(
    (obj) =>
      isConstraint(obj, 'Coincident') &&
      obj.kind.constraint.segments.includes(pointId) &&
      obj.kind.constraint.segments.includes('ORIGIN')
  )
}

function getZeroAxisDistanceConstraintWithOrigin(
  pointId: number,
  constraintType: 'HorizontalDistance' | 'VerticalDistance',
  objects: ApiObject[]
) {
  return (
    objects.find(
      (obj) =>
        isConstraint(obj, constraintType) &&
        obj.kind.constraint.points.includes(pointId) &&
        obj.kind.constraint.points.includes('ORIGIN') &&
        obj.kind.constraint.distance.value === 0
    ) ?? null
  )
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
  dismissConstraintHoverPopup,
}: {
  setLastSuccessfulDragFromPoint: (point: Vector2) => void
  setDraggedEntityId: (entityId: number | null) => void
  getHoveredId: () => SketchSolveSelectionId | null
  dismissConstraintHoverPopup: () => void
}): (arg: {
  intersectionPoint: { twoD: Vector2; threeD: Vector3 }
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<any>
}) => void | Promise<void> {
  return ({ intersectionPoint }) => {
    dismissConstraintHoverPopup()
    setLastSuccessfulDragFromPoint(intersectionPoint.twoD.clone())
    const hoveredId = getHoveredId()
    setDraggedEntityId(isObjectSelectionId(hoveredId) ? hoveredId : null)
  }
}

/**
 * Creates the onDragEnd callback for sketch solve drag operations.
 * Syncs all necessary state between the frontend and the solver.
 *
 * @param sketchExecuteMock - Function to send updated state to Rust side
 */
export function createOnDragEndCallback({
  getDraggedEntityId,
  setDraggedEntityId,
  onComplete,
}: {
  getDraggedEntityId: () => number | null
  setDraggedEntityId: (entityId: number | null) => void
  onComplete: (data: {
    draggedEntityId: number | null
    intersectionPoint?: Partial<{ twoD: Vector2; threeD: Vector3 }>
    mouseEvent: MouseEvent
  }) => Promise<unknown>
}): (arg: {
  intersectionPoint?: Partial<{ twoD: Vector2; threeD: Vector3 }>
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<any>
}) => void | Promise<void> {
  return async ({ intersectionPoint, mouseEvent }) => {
    const draggedEntityId = getDraggedEntityId()
    try {
      await onComplete({ draggedEntityId, intersectionPoint, mouseEvent })
    } finally {
      setDraggedEntityId(null)
    }
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
    selectedIds: Array<SketchSolveSelectionId>
    duringAreaSelectIds: Array<number>
    replaceExistingSelection?: boolean
  }) => void
  onEditConstraint: (constraintId: number) => void
}): (arg: {
  selected?: Object3D
  mouseEvent: MouseEvent
  intersectionPoint?: { twoD: Vector2; threeD: Vector3 }
  intersects: Array<unknown>
}) => Promise<void> {
  return async ({ mouseEvent, intersectionPoint }) => {
    let closestSelection: ClosestSelectionTarget | null = null
    let mousePosition: Coords2d | undefined

    if (intersectionPoint) {
      mousePosition = [
        intersectionPoint.twoD.x,
        intersectionPoint.twoD.y,
      ] as Coords2d

      closestSelection = getClosestSelectionTarget(
        mousePosition,
        getApiObjects(),
        sceneInfra
      )
    }

    const selectedApiObject = closestSelection?.apiObject ?? undefined

    if (
      mouseEvent.detail === 2 &&
      isConstraint(selectedApiObject) &&
      !isInvisibleConstraintObject(selectedApiObject)
    ) {
      // Double clicking on Constraint
      onEditConstraint(selectedApiObject.id)
    } else {
      const shouldReplaceSelection = isConstraint(selectedApiObject)
      if (
        mousePosition &&
        selectedApiObject &&
        isInvisibleConstraintObject(selectedApiObject)
      ) {
        pinSelectedInvisibleConstraintPopup(
          selectedApiObject.id,
          mousePosition,
          getApiObjects(),
          sceneInfra
        )
      }
      onUpdateSelectedIds({
        selectedIds: closestSelection ? [closestSelection.selectionId] : [],
        duringAreaSelectIds: [],
        ...(shouldReplaceSelection ? { replaceExistingSelection: true } : {}),
      })
    }
  }
}

type ScreenRectHitObject = {
  type: 'screenRect'
  center: [number, number, number]
  sizePx: [number, number]
}

function isScreenRectHitObject(
  hitObject: unknown
): hitObject is ScreenRectHitObject {
  return (
    typeof hitObject === 'object' &&
    hitObject !== null &&
    'type' in hitObject &&
    hitObject.type === 'screenRect' &&
    'center' in hitObject &&
    isArray(hitObject.center) &&
    hitObject.center.length === 3
  )
}

function pinSelectedInvisibleConstraintPopup(
  constraintId: number,
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
) {
  const camera = sceneInfra.camControls?.camera
  const rendererElement = sceneInfra.renderer?.domElement
  if (!camera || !rendererElement) {
    return
  }

  const constraintGroup = sceneInfra.scene.getObjectByName(String(constraintId))
  if (!(constraintGroup instanceof Group) || !constraintGroup.visible) {
    return
  }

  const sketchSolveGroupObject =
    sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSolveGroup =
    sketchSolveGroupObject instanceof Group ? sketchSolveGroupObject : null
  const viewportSize = new Vector2(
    rendererElement.clientWidth,
    rendererElement.clientHeight
  )
  const mouseScreenPosition = localToScreen(
    [mousePosition[0], mousePosition[1], 0],
    camera,
    viewportSize,
    sketchSolveGroup
  )
  const closestPopup = findClosestConstraintHoverPopup(
    constraintGroup,
    mouseScreenPosition,
    camera,
    viewportSize,
    sketchSolveGroup
  )

  if (closestPopup) {
    const relatedConstraintIds = findInvisibleConstraintsForSegment(
      objects[closestPopup.segmentId],
      objects
    )
    relatedConstraintIds.forEach((relatedConstraintId) => {
      const relatedConstraintGroup = sceneInfra.scene.getObjectByName(
        String(relatedConstraintId)
      )
      if (!(relatedConstraintGroup instanceof Group)) {
        return
      }

      relatedConstraintGroup.userData.selectedInvisibleConstraintPopup = {
        ownerConstraintId: constraintId,
        segmentId: closestPopup.segmentId,
        position: closestPopup.position,
      }
    })
  }
}

function findClosestConstraintHoverPopup(
  constraintGroup: Group,
  mouseScreenPosition: Vector2,
  camera: Parameters<typeof project3DToScreen>[1],
  viewportSize: Vector2,
  sketchSolveGroup: Group | null
): ConstraintHoverPopup | null {
  let closestPopup: ConstraintHoverPopup | null = null
  let closestDistance = Number.POSITIVE_INFINITY

  constraintGroup.traverse((child) => {
    const hitObjects = child.userData.hitObjects
    const popup = child.userData.constraintHoverPopup
    if (!isArray(hitObjects) || !isConstraintHoverPopup(popup)) {
      return
    }

    hitObjects.forEach((hitObject) => {
      if (!isScreenRectHitObject(hitObject)) {
        return
      }

      const hitScreenPosition = localToScreen(
        hitObject.center,
        camera,
        viewportSize,
        sketchSolveGroup
      )
      const distance = mouseScreenPosition.distanceTo(hitScreenPosition)
      if (distance < closestDistance) {
        closestDistance = distance
        closestPopup = popup
      }
    })
  })

  return closestPopup
}

function localToScreen(
  point: [number, number, number],
  camera: Parameters<typeof project3DToScreen>[1],
  viewportSize: Vector2,
  sketchSolveGroup: Group | null
) {
  const worldPoint = new Vector3(point[0], point[1], point[2])
  if (sketchSolveGroup) {
    sketchSolveGroup.localToWorld(worldPoint)
  }

  return project3DToScreen(worldPoint, camera, viewportSize)
}

const CONSTRAINT_HOVER_POPUP_TIMEOUT_MS = 2000

type ConstraintHoverPopupEntry = {
  popup: ConstraintHoverPopup
  hideTimeoutId: ReturnType<typeof setTimeout> | null
}

function areSameConstraintHoverPopups(
  popups: ConstraintHoverPopup[],
  previousPopups: ConstraintHoverPopup[]
) {
  return (
    popups.length === previousPopups.length &&
    popups.every((popup, index) => {
      const previousPopup = previousPopups[index]
      return (
        popup.segmentId === previousPopup?.segmentId &&
        popup.position[0] === previousPopup?.position?.[0] &&
        popup.position[1] === previousPopup?.position?.[1]
      )
    })
  )
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
  sceneInfra,
  onUpdateDragSnapping,
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
  sceneInfra: SceneInfra
  onUpdateDragSnapping: (candidate: SnappingCandidate | null) => void
}): (arg: {
  intersectionPoint: { twoD: Vector2; threeD: Vector3 }
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<unknown>
}) => Promise<void> {
  return async ({ intersectionPoint, mouseEvent }) => {
    // Prevent concurrent drag operations
    if (getIsSolveInProgress()) {
      return
    }

    const contextData = getContextData()
    const selectedIds = contextData.selectedIds
    const sceneGraphDelta = contextData.sketchExecOutcome?.sceneGraphDelta

    if (!sceneGraphDelta) {
      onUpdateDragSnapping(null)
      return
    }

    const entityUnderCursorId = getDraggedEntityId()
    const coincidentClusterPointIds =
      entityUnderCursorId !== null
        ? getCoincidentCluster(
            entityUnderCursorId,
            sceneGraphDelta.new_graph.objects
          )
        : []

    // If no entity under cursor and no selectedIds, nothing to do
    if (entityUnderCursorId === null && selectedIds.length === 0) {
      onUpdateDragSnapping(null)
      return
    }

    setIsSolveInProgress(true)
    try {
      const twoD = intersectionPoint.twoD
      const snappingCandidate = !allowSnapping(mouseEvent)
        ? null
        : getDragPointSnappingCandidate({
            draggedEntityId: entityUnderCursorId,
            selectedIds,
            sceneGraphDelta,
            sketchId: contextData.sketchId,
            mousePosition: [twoD.x, twoD.y],
            sceneInfra,
          })
      onUpdateDragSnapping(snappingCandidate)

      // Calculate drag vector from last successful drag point to current position
      const dragVec = twoD.clone().sub(getLastSuccessfulDragFromPoint())

      const objects = sceneGraphDelta.new_graph.objects
      const segmentsToEdit: ExistingSegmentCtor[] = []

      // Collect all IDs to edit (entity under cursor + coincident points + selectedIds)
      const idsToEdit = new Set<number>()
      coincidentClusterPointIds.forEach((id) => {
        idsToEdit.add(id)
      })
      selectedIds.forEach((id) => {
        idsToEdit.add(id)
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
        toastSketchSolveError(err)
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
  const constraintHoverPopupState: {
    lastHoveredTargetId: number | null
    entries: ConstraintHoverPopupEntry[]
  } = {
    lastHoveredTargetId: null,
    entries: [],
  }

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
  const selectionBoxState: SelectionBoxVisualState = {
    getSelectionBoxObject,
    setSelectionBoxObject,
    getSelectionBoxGroup,
    setSelectionBoxGroup,
    getLabelsWrapper,
    setLabelsWrapper,
    getBoxDiv,
    setBoxDiv,
    getVerticalLine,
    setVerticalLine,
    getHorizontalLine,
    setHorizontalLine,
  }

  const clearConstraintHoverPopupTimer = (
    entry: ConstraintHoverPopupEntry,
    timerKey: 'hideTimeoutId'
  ) => {
    const timeoutId = entry[timerKey]
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      entry[timerKey] = null
    }
  }

  const getConstraintHoverPopups = () =>
    constraintHoverPopupState.entries.map((entry) => entry.popup)

  const getConstraintHoverPopupEntry = (segmentId: number) =>
    constraintHoverPopupState.entries.find(
      (entry) => entry.popup.segmentId === segmentId
    )

  const removeConstraintHoverPopup = (segmentId: number) => {
    const index = constraintHoverPopupState.entries.findIndex(
      (entry) => entry.popup.segmentId === segmentId
    )
    if (index === -1) {
      return false
    }

    const [entry] = constraintHoverPopupState.entries.splice(index, 1)
    if (entry) {
      clearConstraintHoverPopupTimer(entry, 'hideTimeoutId')
    }

    return true
  }

  const getConstraintHoverPopupEventData = () => {
    const snapshot = self.getSnapshot()
    const popups = getConstraintHoverPopups()
    const shouldIncludeConstraintHoverPopup =
      popups.length > 0 || snapshot.context.constraintHoverPopups.length > 0

    if (!shouldIncludeConstraintHoverPopup) {
      return {}
    }

    return {
      constraintHoverPopups: popups,
    }
  }

  const sendHoveredState = (hoveredId: SketchSolveSelectionId | null) => {
    self.send({
      type: 'update hovered id',
      data: {
        hoveredId,
        ...getConstraintHoverPopupEventData(),
      },
    })
  }

  const getSketchSolveGroup = () => {
    const sketchSolveGroup =
      context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
    return sketchSolveGroup instanceof Group ? sketchSolveGroup : null
  }

  const clearDragSnappingState = () => {
    const sketchSolveGroup = getSketchSolveGroup()
    if (sketchSolveGroup) {
      updateSnappingPreviewSprite({
        sketchSolveGroup,
        sceneInfra: context.sceneInfra,
        snappingCandidate: null,
      })
    }
  }

  const updateDragSnappingState = (candidate: SnappingCandidate | null) => {
    const sketchSolveGroup = getSketchSolveGroup()
    if (sketchSolveGroup) {
      updateSnappingPreviewSprite({
        sketchSolveGroup,
        sceneInfra: context.sceneInfra,
        snappingCandidate: candidate,
      })
    }

    sendHoveredState(
      candidate?.target?.type === ORIGIN_TARGET
        ? ORIGIN_TARGET
        : isPointSnapTarget(candidate?.target)
          ? candidate.target.pointId
          : null
    )
  }

  const clearConstraintHoverPopups = () => {
    constraintHoverPopupState.entries.forEach((entry) => {
      clearConstraintHoverPopupTimer(entry, 'hideTimeoutId')
    })
    constraintHoverPopupState.entries = []
  }

  const hideConstraintHoverPopup = (segmentId: number) => {
    if (removeConstraintHoverPopup(segmentId)) {
      sendHoveredState(self.getSnapshot().context.hoveredId)
    }
  }

  const dismissConstraintHoverPopupOnDragStart = () => {
    const snapshot = self.getSnapshot()
    const hadConstraintHoverPopup =
      constraintHoverPopupState.entries.length > 0 ||
      snapshot.context.constraintHoverPopups.length > 0

    clearConstraintHoverPopups()
    constraintHoverPopupState.lastHoveredTargetId = null
    clearDragSnappingState()

    if (hadConstraintHoverPopup) {
      sendHoveredState(snapshot.context.hoveredId)
    }
  }

  const startConstraintHoverPopup = (segmentId: number, position: Coords2d) => {
    const existingIndex = constraintHoverPopupState.entries.findIndex(
      (entry) => entry.popup.segmentId === segmentId
    )
    const entry = (existingIndex === -1
      ? null
      : constraintHoverPopupState.entries.splice(existingIndex, 1)[0]) ?? {
      popup: { segmentId, position },
      hideTimeoutId: null,
    }

    clearConstraintHoverPopupTimer(entry, 'hideTimeoutId')
    entry.popup = { segmentId, position }
    constraintHoverPopupState.entries.push(entry)
  }

  const scheduleConstraintHoverPopupHide = (
    entry: ConstraintHoverPopupEntry
  ) => {
    clearConstraintHoverPopupTimer(entry, 'hideTimeoutId')
    entry.hideTimeoutId = setTimeout(() => {
      entry.hideTimeoutId = null
      hideConstraintHoverPopup(entry.popup.segmentId)
    }, CONSTRAINT_HOVER_POPUP_TIMEOUT_MS)
  }

  context.sceneInfra.setCallbacks({
    onDragStart: createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggedEntityId,
      getHoveredId: () => self.getSnapshot().context.hoveredId,
      dismissConstraintHoverPopup: dismissConstraintHoverPopupOnDragStart,
    }),
    onDragEnd: createOnDragEndCallback({
      getDraggedEntityId,
      setDraggedEntityId,
      // Send the last up-to-date state from the frontend to Rust. It doesn't know
      // about this last feedback loop yet!
      onComplete: async ({
        draggedEntityId,
        intersectionPoint,
        mouseEvent,
      }) => {
        try {
          clearDragSnappingState()
          sendHoveredState(null)

          const snapshot = self.getSnapshot()
          const sceneGraphDelta =
            snapshot.context.sketchExecOutcome?.sceneGraphDelta
          const snappingCandidate =
            allowSnapping(mouseEvent) &&
            sceneGraphDelta &&
            intersectionPoint?.twoD
              ? getDragPointSnappingCandidate({
                  draggedEntityId,
                  selectedIds: getObjectSelectionIds(
                    snapshot.context.selectedIds
                  ),
                  sceneGraphDelta,
                  sketchId: snapshot.context.sketchId,
                  mousePosition: [
                    intersectionPoint.twoD.x,
                    intersectionPoint.twoD.y,
                  ],
                  sceneInfra: context.sceneInfra,
                })
              : null

          const settings = jsAppSettings(context.rustContext.settingsActor)
          const units = baseUnitToNumericSuffix(
            context.kclManager.fileSettings.defaultLengthUnit
          )
          const snapConstraint =
            snappingCandidate && draggedEntityId !== null
              ? getConstraintForSnapTarget(
                  draggedEntityId,
                  snappingCandidate.target,
                  units
                )
              : null
          const result =
            snappingCandidate &&
            draggedEntityId !== null &&
            snapConstraint !== null
              ? await (async () => {
                  const [x, y] = snappingCandidate.position
                  const editResult = await context.rustContext.editSegments(
                    0,
                    context.sketchId,
                    [
                      {
                        id: draggedEntityId,
                        ctor: {
                          type: 'Point',
                          position: {
                            x: {
                              type: 'Var',
                              value: roundOff(x),
                              units,
                            },
                            y: {
                              type: 'Var',
                              value: roundOff(y),
                              units,
                            },
                          },
                        },
                      },
                    ],
                    settings
                  )

                  if (
                    snapConstraint.type === 'HorizontalDistance' ||
                    snapConstraint.type === 'VerticalDistance'
                  ) {
                    const objects = sceneGraphDelta?.new_graph.objects ?? []
                    const existingSameConstraint =
                      getZeroAxisDistanceConstraintWithOrigin(
                        draggedEntityId,
                        snapConstraint.type,
                        objects
                      )
                    if (existingSameConstraint) {
                      // Same zero distance constraint already exists -> don't add it again
                      return editResult
                    }

                    const oppositeConstraintType =
                      snapConstraint.type === 'HorizontalDistance'
                        ? 'VerticalDistance'
                        : 'HorizontalDistance'
                    const existingOppositeConstraint =
                      getZeroAxisDistanceConstraintWithOrigin(
                        draggedEntityId,
                        oppositeConstraintType,
                        objects
                      )
                    if (existingOppositeConstraint) {
                      // If there is already a 0 distance opposite constraint:
                      // delete that and add a Coincident constraint instead.
                      const deleteResult = await context.rustContext.deleteObjects(
                        SKETCH_FILE_VERSION,
                        context.sketchId,
                        [existingOppositeConstraint.id],
                        [],
                        settings
                      )

                      const addResult = await context.rustContext.addConstraint(
                        SKETCH_FILE_VERSION,
                        context.sketchId,
                        {
                          type: 'Coincident',
                          segments: [draggedEntityId, 'ORIGIN'],
                        },
                        settings
                      )

                      return {
                        kclSource: addResult.kclSource,
                        sceneGraphDelta: {
                          ...addResult.sceneGraphDelta,
                          invalidates_ids:
                            deleteResult.sceneGraphDelta.invalidates_ids ||
                            addResult.sceneGraphDelta.invalidates_ids,
                        },
                      }
                    }
                  }

                  return context.rustContext.addConstraint(
                    SKETCH_FILE_VERSION,
                    context.sketchId,
                    snapConstraint,
                    settings
                  )
                })()
              : await context.rustContext.sketchExecuteMock(
                  SKETCH_FILE_VERSION,
                  context.sketchId
                )

          // Send the event to update the sketch outcome
          self.send({
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
              writeToDisk: false,
            },
          })
        } catch (err) {
          console.error('error in onDragEnd sketchExecuteMock', err)
          toastSketchSolveError(err)
        }
      },
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
          selectedIds: getObjectSelectionIds(snapshot.context.selectedIds),
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
      sceneInfra: context.sceneInfra,
      onUpdateDragSnapping: updateDragSnappingState,
    }),
    onMouseDownSelection: () => {
      const snapshot = self.getSnapshot()
      const hoveredId = snapshot.context.hoveredId
      if (!isObjectSelectionId(hoveredId)) {
        // Only api objects can be dragged, ORIGIN cannot be.
        return false
      }

      const objects =
        snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ??
        []
      // If it's a point which is already coincident with ORIGIN -> don't allow dragging
      return !(
        isPointSegment(objects[hoveredId]) &&
        hasCoincidentConstraintWithOrigin(hoveredId, objects)
      )
    },
    onClick: createOnClickCallback({
      getApiObjects: () => {
        const snapshot = self.getSnapshot()
        return getCurrentSketchObjectsById(
          snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph
            .objects ?? [],
          snapshot.context.sketchId
        )
      },
      sceneInfra: context.sceneInfra,
      onUpdateSelectedIds: (data: {
        selectedIds: Array<SketchSolveSelectionId>
        duringAreaSelectIds: Array<number>
        replaceExistingSelection?: boolean
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

      const apiObjects = getCurrentSketchObjectsById(
        snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ??
          [],
        snapshot.context.sketchId
      )
      const hoveredTarget = getClosestSelectionTarget(
        mousePosition,
        apiObjects,
        context.sceneInfra
      )
      const hoveredApiObject = hoveredTarget?.apiObject ?? null
      const hoveredId = hoveredTarget?.selectionId ?? null
      const lastHoveredId = snapshot.context.hoveredId
      const constraintHoverPopupSegmentId =
        hoveredApiObject !== null && !isConstraint(hoveredApiObject)
          ? hoveredApiObject.id
          : null
      const previousConstraintHoverPopups =
        snapshot.context.constraintHoverPopups

      if (
        constraintHoverPopupSegmentId !==
          constraintHoverPopupState.lastHoveredTargetId &&
        constraintHoverPopupSegmentId !== null &&
        // If this segment already has a visible popup, keep that popup pinned where it is.
        !getConstraintHoverPopupEntry(constraintHoverPopupSegmentId) &&
        !snapshot.context.showNonVisualConstraints &&
        findInvisibleConstraintsForSegment(hoveredApiObject, apiObjects)
          .length > 0
      ) {
        startConstraintHoverPopup(constraintHoverPopupSegmentId, mousePosition)
      }
      constraintHoverPopupState.lastHoveredTargetId =
        constraintHoverPopupSegmentId

      constraintHoverPopupState.entries.forEach((entry) => {
        const isHoveringSourceSegment =
          constraintHoverPopupSegmentId === entry.popup.segmentId
        const isHoveringConstraintHoverPopup =
          isInvisibleConstraintObject(hoveredApiObject) &&
          isConstrainingSegment(
            hoveredApiObject,
            apiObjects[entry.popup.segmentId],
            apiObjects
          )

        if (isHoveringSourceSegment || isHoveringConstraintHoverPopup) {
          clearConstraintHoverPopupTimer(entry, 'hideTimeoutId')
        } else if (entry.hideTimeoutId === null) {
          scheduleConstraintHoverPopupHide(entry)
        }
      })

      const currentConstraintHoverPopups = getConstraintHoverPopups()
      const constraintHoverPopupsChanged = !areSameConstraintHoverPopups(
        currentConstraintHoverPopups,
        previousConstraintHoverPopups
      )

      if (hoveredId !== lastHoveredId || constraintHoverPopupsChanged) {
        sendHoveredState(hoveredId)
      }
    },
    onAreaSelectStart: ({ startPoint }) => {
      const scaledStartPoint = startPoint.threeD
        .clone()
        .multiplyScalar(context.sceneInfra.baseUnitMultiplier)
      // Area select started - create the selection box visual and clear any previous area select
      if (startPoint.threeD) {
        updateSelectionBox({
          startPoint3D: scaledStartPoint,
          currentPoint3D: scaledStartPoint,
          sceneInfra: context.sceneInfra,
          selectionBoxState,
        })
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
        updateSelectionBox({
          startPoint3D: scaledStartPoint,
          currentPoint3D: scaledCurrentPoint,
          sceneInfra: context.sceneInfra,
          selectionBoxState,
        })

        const snapshot = self.getSnapshot()
        const apiObjects = getCurrentSketchObjectsById(
          snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph
            .objects ?? [],
          snapshot.context.sketchId
        )

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
        const duringAreaSelectIds = isIntersectionBox
          ? findIntersectingSegments(apiObjects, startCoords, currentCoords)
          : findContainedSegments(apiObjects, startCoords, currentCoords)

        // Update duringAreaSelectIds (temporary selection during drag)
        self.send({
          type: 'update selected ids',
          data: { duringAreaSelectIds },
        })
      }
    },
    onAreaSelectEnd: () => {
      // Remove selection box visual
      removeSelectionBox(selectionBoxState)

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
