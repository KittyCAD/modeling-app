import type {
  ApiObject,
  ExistingSegmentCtor,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { isArray, roundOff } from '@src/lib/utils'
import { Group, type Object3D, Vector2, Vector3 } from 'three'
import { baseUnitToNumericSuffix, type NumericSuffix } from '@src/lang/wasm'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { DeepPartial } from '@src/lib/types'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import {
  buildSegmentCtorFromObject,
  type SolveActionArgs,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { applyVectorToPoint2D } from '@src/lib/kclHelpers'
import {
  findContainedSegments,
  findIntersectingSegments,
  isIntersectionSelectionMode,
  project3DToScreen,
  removeSelectionBox,
  type SelectionBoxVisualState,
  updateSelectionBox,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'
import {
  getOtherCoincidentIdsByPointId,
  isConstraint,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  type ConstraintHoverPopup,
  findInvisibleConstraintsForSegment,
  isInvisibleConstraintObject,
  isConstrainingSegment,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import { isConstraintHoverPopup } from '@src/machines/sketchSolve/constraints/InvisibleConstraintSpriteBuilder'
import type {
  OnMoveCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import type { ClosestApiObject } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import {
  allowSnapping,
  getSnappingCandidates,
  type SnappingCandidate,
} from '@src/machines/sketchSolve/snapping'
import {
  hideSnappingPreviewSprite,
  updateSnappingPreviewSprite,
} from '@src/machines/sketchSolve/snappingPreviewSprite'

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
}): { sourcePointId: number; candidate: SnappingCandidate | null } | null {
  if (draggedEntityId === null) {
    return null
  }
  if (
    selectedIds.length >= 2 ||
    (selectedIds.length === 1 && selectedIds[0] !== draggedEntityId)
  ) {
    // dragging more than 1 point -> not supported
    return null
  }

  const draggedObject = sceneGraphDelta.new_graph.objects[draggedEntityId]
  if (!isPointSegment(draggedObject)) {
    // snapping only works with points for now
    return null
  }

  const coincidentPointIds = getOtherCoincidentIdsByPointId(
    draggedEntityId,
    sceneGraphDelta.new_graph
  )

  const currentSketchObjects = getCurrentSketchObjectsById(
    sceneGraphDelta.new_graph.objects,
    sketchId
  )
  const candidate =
    getSnappingCandidates(mousePosition, {
      objects: currentSketchObjects,
      sceneInfra,
    }).find(
      (candidate) =>
        candidate.apiObject.id !== draggedEntityId &&
        !coincidentPointIds.includes(candidate.apiObject.id)
    ) ?? null

  return {
    sourcePointId: draggedEntityId,
    candidate,
  }
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
  getHoveredId: () => number | null
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
    setDraggedEntityId(getHoveredId())
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
    selectedIds: Array<number>
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
    let closestObject: ClosestApiObject | undefined
    let mousePosition: Coords2d | undefined

    if (intersectionPoint) {
      mousePosition = [
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

    if (
      mouseEvent.detail === 2 &&
      isConstraint(closestObject?.apiObject) &&
      !isInvisibleConstraintObject(closestObject.apiObject)
    ) {
      // Double clicking on Constraint
      onEditConstraint(closestObject.apiObject.id)
    } else {
      const shouldReplaceSelection = isConstraint(closestObject?.apiObject)
      if (
        mousePosition &&
        closestObject &&
        isInvisibleConstraintObject(closestObject.apiObject)
      ) {
        pinSelectedInvisibleConstraintPopup(
          closestObject.apiObject.id,
          mousePosition,
          getApiObjects(),
          sceneInfra
        )
      }
      onUpdateSelectedIds({
        selectedIds: closestObject ? [closestObject.apiObject.id] : [],
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
    const entitiesCoincidentWithUnderCursor =
      entityUnderCursorId !== null
        ? getOtherCoincidentIdsByPointId(
            entityUnderCursorId,
            sceneGraphDelta.new_graph
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
      const dragSnapping = !allowSnapping(mouseEvent)
        ? null
        : getDragPointSnappingCandidate({
            draggedEntityId: entityUnderCursorId,
            selectedIds,
            sceneGraphDelta,
            sketchId: contextData.sketchId,
            mousePosition: [twoD.x, twoD.y],
            sceneInfra,
          })
      onUpdateDragSnapping(dragSnapping?.candidate ?? null)

      // Calculate drag vector from last successful drag point to current position
      const dragVec = twoD.clone().sub(getLastSuccessfulDragFromPoint())

      const objects = sceneGraphDelta.new_graph.objects
      const segmentsToEdit: ExistingSegmentCtor[] = []

      // Collect all IDs to edit (entity under cursor + coincident points + selectedIds)
      const idsToEdit = new Set<number>()
      if (entityUnderCursorId !== null && !Number.isNaN(entityUnderCursorId)) {
        idsToEdit.add(entityUnderCursorId)
      }

      entitiesCoincidentWithUnderCursor.forEach((id) => {
        if (!Number.isNaN(id)) {
          idsToEdit.add(id)
        }
      })
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

  const sendHoveredState = (hoveredId: number | null) => {
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
      hideSnappingPreviewSprite(sketchSolveGroup)
    }
  }

  const updateDragSnappingState = (candidate: SnappingCandidate | null) => {
    const sketchSolveGroup = getSketchSolveGroup()
    if (sketchSolveGroup) {
      updateSnappingPreviewSprite({
        sketchSolveGroup,
        sceneInfra: context.sceneInfra,
        targetPoint: candidate?.apiObject ?? null,
      })
    }

    sendHoveredState(candidate?.apiObject.id ?? null)
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
          const dragSnapping =
            allowSnapping(mouseEvent) &&
            sceneGraphDelta &&
            intersectionPoint?.twoD
              ? getDragPointSnappingCandidate({
                  draggedEntityId,
                  selectedIds: snapshot.context.selectedIds,
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
          const snapCandidate = dragSnapping?.candidate
          const result = snapCandidate
            ? await (async () => {
                const units = baseUnitToNumericSuffix(
                  context.kclManager.fileSettings.defaultLengthUnit
                )
                const [x, y] = snapCandidate.position

                await context.rustContext.editSegments(
                  0,
                  context.sketchId,
                  [
                    {
                      id: dragSnapping.sourcePointId,
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

                return context.rustContext.addConstraint(
                  SKETCH_FILE_VERSION,
                  context.sketchId,
                  {
                    type: 'Coincident',
                    segments: [
                      dragSnapping.sourcePointId,
                      snapCandidate.apiObject.id,
                    ],
                  },
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
      sceneInfra: context.sceneInfra,
      onUpdateDragSnapping: updateDragSnappingState,
    }),
    onMouseDownSelection: () => {
      return self.getSnapshot().context.hoveredId !== null
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
        selectedIds: Array<number>
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
      const closestObjects = findClosestApiObjects(
        mousePosition,
        apiObjects,
        context.sceneInfra
      )
      const hoveredObject: ClosestApiObject | null = closestObjects[0] ?? null
      const hoveredApiObject = hoveredObject?.apiObject ?? null
      const hoveredId = hoveredApiObject?.id ?? null
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
