import type {
  ApiObject,
  ExistingSegmentCtor,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'
import { type Object3D, type Vector3, type Group, Vector2 } from 'three'
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
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  findInvisibleConstraintsForSegment,
  isInvisibleConstraintObject,
  isConstraingSegment,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import type {
  OnMoveCallbackArgs,
  SceneInfra,
} from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import type { ClosestApiObject } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'

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
 * Syncs all necessary state between the frontend and the solver.
 *
 * @param sketchExecuteMock - Function to send updated state to Rust side
 */
export function createOnDragEndCallback({
  setDraggedEntityId,
  onComplete,
}: {
  setDraggedEntityId: (entityId: number | null) => void
  onComplete: () => Promise<unknown>
}): (arg: {
  intersectionPoint?: Partial<{ twoD: Vector2; threeD: Vector3 }>
  selected?: Object3D
  mouseEvent: MouseEvent
  intersects: Array<any>
}) => void | Promise<void> {
  return async () => {
    setDraggedEntityId(null)
    await onComplete()
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
      const shouldReplaceSelection = isConstraint(closestObject?.apiObject)
      onUpdateSelectedIds({
        selectedIds: closestObject ? [closestObject.apiObject.id] : [],
        duringAreaSelectIds: [],
        ...(shouldReplaceSelection ? { replaceExistingSelection: true } : {}),
      })
    }
  }
}

type HoveredConstraintPreview = {
  targetId: number
  position: Coords2d
}

const HOVERED_CONSTRAINT_PREVIEW_TIMEOUT_MS = 2000

function hasInvisibleConstraintPreviewTarget(
  object: ApiObject | null,
  objects: ApiObject[]
) {
  return findInvisibleConstraintsForSegment(object, objects).length > 0
}

function isSameHoveredConstraintPreview(
  preview: HoveredConstraintPreview | null,
  targetId: number | null,
  position: Coords2d | null
) {
  return (
    (preview?.targetId ?? null) === targetId &&
    preview?.position?.[0] === position?.[0] &&
    preview?.position?.[1] === position?.[1]
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
    const entitiesCoincidentWithUnderCursor = entityUnderCursorId
      ? getOtherCoincidentIdsByPointId(
          entityUnderCursorId,
          sceneGraphDelta.new_graph
        )
      : []

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
  const hoveredConstraintPreviewState: {
    lastHoveredTargetId: number | null
    preview: HoveredConstraintPreview | null
    isHoveringPreview: boolean
    previewTimeoutId: ReturnType<typeof setTimeout> | null
    hideTimeoutId: ReturnType<typeof setTimeout> | null
  } = {
    lastHoveredTargetId: null,
    preview: null,
    isHoveringPreview: false,
    previewTimeoutId: null,
    hideTimeoutId: null,
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

  const clearHoveredConstraintPreviewTimer = (
    timerKey: 'previewTimeoutId' | 'hideTimeoutId'
  ) => {
    const timeoutId = hoveredConstraintPreviewState[timerKey]
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      hoveredConstraintPreviewState[timerKey] = null
    }
  }

  const clearHoveredConstraintPreviewTimers = () => {
    clearHoveredConstraintPreviewTimer('previewTimeoutId')
    clearHoveredConstraintPreviewTimer('hideTimeoutId')
  }

  const getHoveredConstraintPreviewEventData = () => {
    const snapshot = self.getSnapshot()
    const { preview } = hoveredConstraintPreviewState
    const shouldIncludeHoveredConstraintPreview =
      preview !== null ||
      snapshot.context.hoveredConstraintPreviewTargetId !== null ||
      snapshot.context.hoveredConstraintPreviewPosition !== null

    if (!shouldIncludeHoveredConstraintPreview) {
      return {}
    }

    return {
      hoveredConstraintPreviewTargetId: preview?.targetId ?? null,
      hoveredConstraintPreviewPosition: preview?.position ?? null,
    }
  }

  const sendHoveredState = (hoveredId: number | null) => {
    self.send({
      type: 'update hovered id',
      data: {
        hoveredId,
        ...getHoveredConstraintPreviewEventData(),
      },
    })
  }

  const clearHoveredConstraintPreview = () => {
    clearHoveredConstraintPreviewTimers()
    hoveredConstraintPreviewState.preview = null
    hoveredConstraintPreviewState.isHoveringPreview = false
  }

  const hideHoveredConstraintPreview = () => {
    clearHoveredConstraintPreview()
    sendHoveredState(self.getSnapshot().context.hoveredId)
  }

  const startHoveredConstraintPreview = (
    targetId: number,
    position: Coords2d
  ) => {
    clearHoveredConstraintPreviewTimers()
    hoveredConstraintPreviewState.preview = {
      targetId,
      position,
    }
    hoveredConstraintPreviewState.isHoveringPreview = false
    hoveredConstraintPreviewState.previewTimeoutId = setTimeout(() => {
      hoveredConstraintPreviewState.previewTimeoutId = null
      if (!hoveredConstraintPreviewState.isHoveringPreview) {
        hideHoveredConstraintPreview()
      }
    }, HOVERED_CONSTRAINT_PREVIEW_TIMEOUT_MS)
  }

  const scheduleHoveredConstraintPreviewHide = () => {
    clearHoveredConstraintPreviewTimer('hideTimeoutId')
    hoveredConstraintPreviewState.hideTimeoutId = setTimeout(() => {
      hoveredConstraintPreviewState.hideTimeoutId = null
      hideHoveredConstraintPreview()
    }, HOVERED_CONSTRAINT_PREVIEW_TIMEOUT_MS)
  }

  context.sceneInfra.setCallbacks({
    onDragStart: createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggedEntityId,
      getHoveredId: () => self.getSnapshot().context.hoveredId,
    }),
    onDragEnd: createOnDragEndCallback({
      setDraggedEntityId,
      // Send the last up-to-date state from the frontend to Rust. It doesn't know
      // about this last feedback loop yet!
      onComplete: async () => {
        try {
          const result = await context.rustContext.sketchExecuteMock(
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
      const hoveredConstraintPreviewTargetId =
        hoveredApiObject !== null && !isConstraint(hoveredApiObject)
          ? hoveredApiObject.id
          : null
      const { preview } = hoveredConstraintPreviewState
      const isHoveringHoveredConstraintPreview =
        preview !== null &&
        isInvisibleConstraintObject(hoveredApiObject) &&
        isConstraingSegment(hoveredApiObject, apiObjects[preview.targetId])
      const previousHoveredConstraintPreviewTargetId =
        snapshot.context.hoveredConstraintPreviewTargetId
      const previousHoveredConstraintPreviewPosition =
        snapshot.context.hoveredConstraintPreviewPosition

      if (
        hoveredConstraintPreviewTargetId !==
          hoveredConstraintPreviewState.lastHoveredTargetId &&
        hoveredConstraintPreviewTargetId !== null &&
        preview?.targetId !== hoveredConstraintPreviewTargetId &&
        !snapshot.context.showNonVisualConstraints &&
        hasInvisibleConstraintPreviewTarget(hoveredApiObject, apiObjects)
      ) {
        startHoveredConstraintPreview(
          hoveredConstraintPreviewTargetId,
          mousePosition
        )
      }
      hoveredConstraintPreviewState.lastHoveredTargetId =
        hoveredConstraintPreviewTargetId

      if (isHoveringHoveredConstraintPreview) {
        if (!hoveredConstraintPreviewState.isHoveringPreview) {
          hoveredConstraintPreviewState.isHoveringPreview = true
          clearHoveredConstraintPreviewTimers()
        }
      } else if (hoveredConstraintPreviewState.isHoveringPreview) {
        hoveredConstraintPreviewState.isHoveringPreview = false
        scheduleHoveredConstraintPreviewHide()
      }

      const currentHoveredConstraintPreview =
        hoveredConstraintPreviewState.preview
      const hoveredConstraintPreviewChanged = !isSameHoveredConstraintPreview(
        currentHoveredConstraintPreview,
        previousHoveredConstraintPreviewTargetId,
        previousHoveredConstraintPreviewPosition
      )

      if (hoveredId !== lastHoveredId || hoveredConstraintPreviewChanged) {
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
