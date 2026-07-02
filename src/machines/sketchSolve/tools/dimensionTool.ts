import type {
  ApiConstraint,
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { toastToolbar } from '@src/lib/toolbarToast'
import { roundOff } from '@src/lib/utils'
import {
  dot2d,
  getCcwSweep,
  getLineIntersection,
  length2d,
  normalizeVec,
  scaleVec,
  subVec,
} from '@src/lib/utils2d'
import {
  getLinePoints,
  isLineSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import type {
  SelectionCoordinates,
  SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import { setup } from 'xstate'

type DimensionToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  initialSelectionIds: SketchSolveSelectionId[]
  initialSelectionCoordinates: SelectionCoordinates
  initialObjects: ApiObject[]
  runtime: DraftRuntime
}

type DimensionToolInput = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  initialSelectionIds?: SketchSolveSelectionId[]
  initialSelectionCoordinates?: SelectionCoordinates
  initialObjects?: ApiObject[]
  sceneGraphDelta?: SceneGraphDelta
}

type DimensionToolEvent =
  | BaseToolEvent
  | {
      type: 'done'
    }

type ParentSketchSolveSender = {
  _parent?: { send: (event: SketchSolveMachineEvent) => void }
}

type DimensionToolSelf = ParentSketchSolveSender & {
  send: (event: DimensionToolEvent) => void
}

type LineSelection = {
  id: number
  clickPoint: Coords2d
}

export type AngleSector = 1 | 2 | 3 | 4

export type DimensionAngleDraftContext = {
  line0Id: number
  line1Id: number
  line0Direction: Coords2d
  line1Direction: Coords2d
  vertex: Coords2d
  baseSelection: DimensionAngleSelection
}

type DimensionAngleDirections = {
  line0Direction: Coords2d
  line1Direction: Coords2d
}

type DimensionAngleSelection = {
  sector: AngleSector
  inverse: boolean
}

type DraftRuntime = {
  firstSelection: LineSelection | null
  angleContext: DimensionAngleDraftContext | null
  draftConstraintId: number | null
  lastDraftKey: string | null
  previewInFlight: boolean
  queuedMousePoint: Coords2d | null
  // Used by async api calls in case tool got deactivated since
  active: boolean
}

type ApiAngleConstraint = Extract<ApiConstraint, { type: 'Angle' }>

const ANGLE_SECTORS = [1, 2, 3, 4] as const satisfies ReadonlyArray<AngleSector>
const ANGLE_SECTOR_PROMPT_TOAST_ID = 'dimension-tool-angle-sector-prompt'

function getDefaultLengthUnit(kclManager: KclManager): NumericSuffix {
  return baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit ?? 'mm'
  )
}

function sendParent(
  self: ParentSketchSolveSender,
  event: SketchSolveMachineEvent
) {
  self._parent?.send(event)
}

function createRuntime(): DraftRuntime {
  return {
    firstSelection: null,
    angleContext: null,
    draftConstraintId: null,
    lastDraftKey: null,
    previewInFlight: false,
    queuedMousePoint: null,
    active: true,
  }
}

function deactivateRuntime(runtime: DraftRuntime) {
  runtime.active = false
  runtime.queuedMousePoint = null
}

function isClickedRayDirectionForward(
  linePoints: readonly [Coords2d, Coords2d],
  vertex: Coords2d,
  clickPoint: Coords2d
): boolean {
  const lineDirection = normalizeVec(subVec(linePoints[1], linePoints[0]))
  const clickDirection = subVec(clickPoint, vertex)
  return dot2d(clickDirection, lineDirection) >= 0
}

// Given which side of line0 and line1 the user clicked, which semantic sector is that?
export function getBaseAngleSector(
  line0RayDirectionIsForward: boolean,
  line1RayDirectionIsForward: boolean
): AngleSector {
  if (line0RayDirectionIsForward && line1RayDirectionIsForward) {
    return 1
  }
  if (!line0RayDirectionIsForward && line1RayDirectionIsForward) {
    return 2
  }
  if (!line0RayDirectionIsForward && !line1RayDirectionIsForward) {
    return 3
  }
  return 4
}

// Given a sector number, what are the ordered start/end rays used to measure the angle?
export function getAngleSectorRays(
  angleContext: DimensionAngleDirections,
  sector: AngleSector
): [Coords2d, Coords2d] {
  switch (sector) {
    case 1:
      return [angleContext.line0Direction, angleContext.line1Direction]
    case 2:
      return [
        angleContext.line1Direction,
        scaleVec(angleContext.line0Direction, -1),
      ]
    case 3:
      return [
        scaleVec(angleContext.line0Direction, -1),
        scaleVec(angleContext.line1Direction, -1),
      ]
    case 4:
      return [
        scaleVec(angleContext.line1Direction, -1),
        angleContext.line0Direction,
      ]
  }
}

function getDimensionAngleContext(
  firstSelection: LineSelection,
  secondSelection: LineSelection,
  objects: ApiObject[]
): DimensionAngleDraftContext | null {
  const line0 = objects[firstSelection.id]
  const line1 = objects[secondSelection.id]
  const line0Points = getLinePoints(line0, objects)
  const line1Points = getLinePoints(line1, objects)
  if (!line0Points || !line1Points) {
    return null
  }

  const line0Vector = subVec(line0Points[1], line0Points[0])
  const line1Vector = subVec(line1Points[1], line1Points[0])
  if (length2d(line0Vector) === 0 || length2d(line1Vector) === 0) {
    return null
  }

  const vertex = getLineIntersection(line0Points, line1Points)
  if (!vertex) {
    return null
  }

  const line0RayDirectionIsForward = isClickedRayDirectionForward(
    line0Points,
    vertex,
    firstSelection.clickPoint
  )
  const line1RayDirectionIsForward = isClickedRayDirectionForward(
    line1Points,
    vertex,
    secondSelection.clickPoint
  )

  const angleContextBase = {
    line0Id: firstSelection.id,
    line1Id: secondSelection.id,
    line0Direction: normalizeVec(line0Vector),
    line1Direction: normalizeVec(line1Vector),
    vertex,
  }
  return {
    ...angleContextBase,
    baseSelection: getVisibleAngleSelection(
      angleContextBase,
      getBaseAngleSector(line0RayDirectionIsForward, line1RayDirectionIsForward)
    ),
  }
}

function getFarthestLinePointFromVertex(
  linePoints: readonly [Coords2d, Coords2d],
  vertex: Coords2d
): Coords2d {
  return length2d(subVec(linePoints[1], vertex)) >=
    length2d(subVec(linePoints[0], vertex))
    ? linePoints[1]
    : linePoints[0]
}

function getInitialAngleLineSelections(
  selectionIds: readonly SketchSolveSelectionId[],
  selectionCoordinates: SelectionCoordinates,
  objects: ApiObject[]
): [LineSelection, LineSelection] | null {
  const lineIds = selectionIds.filter(
    (id): id is number => typeof id === 'number'
  )
  if (lineIds.length !== 2) {
    return null
  }

  const line0Points = getLinePoints(objects[lineIds[0]], objects)
  const line1Points = getLinePoints(objects[lineIds[1]], objects)
  if (!line0Points || !line1Points) {
    return null
  }

  const vertex = getLineIntersection(line0Points, line1Points)
  if (!vertex) {
    return null
  }

  return [
    {
      id: lineIds[0],
      clickPoint:
        selectionCoordinates[lineIds[0]] ??
        getFarthestLinePointFromVertex(line0Points, vertex),
    },
    {
      id: lineIds[1],
      clickPoint:
        selectionCoordinates[lineIds[1]] ??
        getFarthestLinePointFromVertex(line1Points, vertex),
    },
  ]
}

function getVisibleAngleSelection(
  angleContext: DimensionAngleDirections,
  sector: AngleSector
): DimensionAngleSelection {
  const [start, end] = getAngleSectorRays(angleContext, sector)
  return {
    sector,
    inverse: getCcwSweep(start, end) > Math.PI,
  }
}

function getVisibleAngleSectorRays(
  angleContext: DimensionAngleDirections,
  selection: DimensionAngleSelection
): [Coords2d, Coords2d] {
  const [start, end] = getAngleSectorRays(angleContext, selection.sector)
  return selection.inverse ? [end, start] : [start, end]
}

function getHoveredAngleSelection(
  mousePoint: Coords2d,
  angleContext: DimensionAngleDraftContext
): DimensionAngleSelection {
  const mouseDirection = subVec(mousePoint, angleContext.vertex)
  if (length2d(mouseDirection) === 0) {
    return angleContext.baseSelection
  }

  return (
    ANGLE_SECTORS.map((sector) =>
      getVisibleAngleSelection(angleContext, sector)
    ).find((selection) => {
      const [start, end] = getVisibleAngleSectorRays(angleContext, selection)
      const isDirectionInSector =
        getCcwSweep(start, mouseDirection) <= getCcwSweep(start, end) + 1e-9

      return isDirectionInSector
    }) ?? angleContext.baseSelection
  )
}

function invertAngleSelection(
  selection: DimensionAngleSelection
): DimensionAngleSelection {
  return {
    sector: selection.sector,
    inverse: !selection.inverse,
  }
}

export function getDimensionAngleSelection(
  mousePoint: Coords2d,
  angleContext: DimensionAngleDraftContext
): DimensionAngleSelection {
  const hoveredSelection = getHoveredAngleSelection(mousePoint, angleContext)
  const oppositeBaseSector = ((angleContext.baseSelection.sector + 1) % 4) + 1

  if (hoveredSelection.sector === oppositeBaseSector) {
    return invertAngleSelection(angleContext.baseSelection)
  }

  return hoveredSelection
}

function getDimensionAngleDegrees(
  angleContext: DimensionAngleDraftContext,
  selection: DimensionAngleSelection
) {
  let [start, end] = getAngleSectorRays(angleContext, selection.sector)
  if (selection.inverse) {
    ;[start, end] = [end, start]
  }

  return roundOff((getCcwSweep(start, end) * 180) / Math.PI)
}

function toNumber(value: number, units: NumericSuffix) {
  return {
    value: roundOff(value),
    units,
  }
}

export function buildDimensionAngleConstraint(
  angleContext: DimensionAngleDraftContext,
  mousePoint: Coords2d,
  units: NumericSuffix
): ApiAngleConstraint {
  const selection = getDimensionAngleSelection(mousePoint, angleContext)
  const angle = getDimensionAngleDegrees(angleContext, selection)

  return {
    type: 'Angle',
    lines: [angleContext.line0Id, angleContext.line1Id],
    angle: { value: angle, units: 'Deg' },
    sector: selection.sector,
    inverse: selection.inverse,
    labelPosition: {
      x: toNumber(mousePoint[0], units),
      y: toNumber(mousePoint[1], units),
    },
    source: {
      expr: `${angle}deg`,
      is_literal: true,
    },
  }
}

function getConstraintIdFromResult(result: {
  sceneGraphDelta: SceneGraphDelta
}): number | null {
  return (
    [...result.sceneGraphDelta.new_objects].reverse().find((objectId) => {
      const object = result.sceneGraphDelta.new_graph.objects[objectId]
      return (
        object?.kind.type === 'Constraint' &&
        object.kind.constraint.type === 'Angle'
      )
    }) ?? null
  )
}

function getDraftKey(constraint: ApiAngleConstraint) {
  return [
    constraint.lines.join(','),
    constraint.angle.value,
    constraint.sector ?? '',
    constraint.inverse === true ? 'inverse' : 'direct',
    constraint.labelPosition?.x.value ?? '',
    constraint.labelPosition?.y.value ?? '',
  ].join(':')
}

async function deleteInactivePreviewConstraint(
  context: DimensionToolContext,
  constraintId: number
) {
  await context.rustContext.deleteObjects(
    SKETCH_FILE_VERSION,
    context.sketchId,
    [constraintId],
    [],
    jsAppSettings(context.rustContext.settingsActor),
    false
  )
}

function sendPreviewResultToParent(
  self: ParentSketchSolveSender,
  result: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    checkpointId?: number | null
  }
) {
  sendParent(self, {
    type: 'update sketch outcome',
    data: {
      sourceDelta: result.kclSource,
      sceneGraphDelta: result.sceneGraphDelta,
      checkpointId: result.checkpointId ?? null,
      writeToDisk: false,
      addToHistory: false,
      suppressExecOutcomeIssues: true,
    },
  })
}

async function updateDraftAngleConstraint(
  runtime: DraftRuntime,
  context: DimensionToolContext,
  self: ParentSketchSolveSender,
  mousePoint: Coords2d
) {
  if (!runtime.active || !runtime.angleContext) {
    return
  }

  const constraint = buildDimensionAngleConstraint(
    runtime.angleContext,
    mousePoint,
    getDefaultLengthUnit(context.kclManager)
  )
  const draftKey = getDraftKey(constraint)
  // Skip constraint edits when the mouse moved too little to change the draft.
  if (draftKey === runtime.lastDraftKey) {
    return
  }

  const settings = jsAppSettings(context.rustContext.settingsActor)
  const existingConstraintId = runtime.draftConstraintId
  const result =
    existingConstraintId === null
      ? await context.rustContext.addConstraint(
          SKETCH_FILE_VERSION,
          context.sketchId,
          constraint,
          settings,
          false
        )
      : await context.rustContext.editAngleConstraint(
          SKETCH_FILE_VERSION,
          context.sketchId,
          existingConstraintId,
          constraint,
          settings,
          false,
          false
        )

  const constraintId = existingConstraintId ?? getConstraintIdFromResult(result)
  if (constraintId === null) {
    return
  }
  if (!runtime.active) {
    if (existingConstraintId === null) {
      await deleteInactivePreviewConstraint(context, constraintId)
    }
    return
  }

  runtime.draftConstraintId = constraintId
  runtime.lastDraftKey = draftKey

  sendPreviewResultToParent(self, result)
  if (existingConstraintId === null) {
    sendParent(self, {
      type: 'set draft entities',
      data: {
        segmentIds: [],
        constraintIds: [constraintId],
      },
    })
  }
}

function requestDraftPreview(
  runtime: DraftRuntime,
  context: DimensionToolContext,
  self: ParentSketchSolveSender,
  mousePoint: Coords2d
) {
  if (!runtime.active) {
    return
  }

  runtime.queuedMousePoint = mousePoint
  if (runtime.previewInFlight) {
    return
  }

  runtime.previewInFlight = true
  void (async () => {
    try {
      while (runtime.active && runtime.queuedMousePoint) {
        const nextMousePoint = runtime.queuedMousePoint
        runtime.queuedMousePoint = null
        await updateDraftAngleConstraint(runtime, context, self, nextMousePoint)
      }
    } catch (error) {
      toastSketchSolveError(error)
    } finally {
      runtime.previewInFlight = false
    }
  })()
}

async function commitDraftAngleConstraint(
  runtime: DraftRuntime,
  context: DimensionToolContext,
  self: DimensionToolSelf,
  mousePoint: Coords2d
) {
  if (!runtime.active || !runtime.angleContext) {
    return
  }

  const constraint = buildDimensionAngleConstraint(
    runtime.angleContext,
    mousePoint,
    getDefaultLengthUnit(context.kclManager)
  )

  try {
    deactivateRuntime(runtime)
    const settings = jsAppSettings(context.rustContext.settingsActor)
    // This is normally never null, except for edge cases:
    // - click is faster than draft preview creation
    // - draft preview creation failed
    const existingConstraintId = runtime.draftConstraintId
    const result =
      existingConstraintId === null
        ? await context.rustContext.addConstraint(
            SKETCH_FILE_VERSION,
            context.sketchId,
            constraint,
            settings,
            true
          )
        : await context.rustContext.editAngleConstraint(
            SKETCH_FILE_VERSION,
            context.sketchId,
            existingConstraintId,
            constraint,
            settings,
            true,
            true
          )

    const constraintId =
      existingConstraintId ?? getConstraintIdFromResult(result)
    runtime.draftConstraintId = null
    sendParent(self, {
      type: 'update sketch outcome',
      data: {
        sourceDelta: result.kclSource,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId: result.checkpointId ?? null,
      },
    })
    sendParent(self, { type: 'clear draft entities' })
    sendParent(self, {
      type: 'update selected ids',
      data: { selectedIds: [], duringAreaSelectIds: [] },
    })
    sendParent(self, {
      type: 'update hovered id',
      data: { hoveredId: constraintId },
    })
    toastToolbar.dismiss(ANGLE_SECTOR_PROMPT_TOAST_ID)
    self.send({ type: 'done' })
  } catch (error) {
    runtime.active = true
    toastSketchSolveError(error)
  }
}

function getClosestLineSelection(
  mousePoint: Coords2d,
  context: DimensionToolContext
): LineSelection | null {
  const currentSketchObjects = getCurrentSketchObjectsById(
    context.initialObjects,
    context.sketchId
  )
  const closestLine = findClosestApiObjects(
    mousePoint,
    currentSketchObjects,
    context.sceneInfra
  ).find(({ apiObject }) => isLineSegment(apiObject))

  if (!closestLine) {
    return null
  }

  return {
    id: closestLine.apiObject.id,
    clickPoint: mousePoint,
  }
}

function addDimensionListener({
  context,
  self,
}: {
  context: DimensionToolContext
  self: DimensionToolSelf
}) {
  const runtime = context.runtime
  runtime.active = true
  const initialObjects = context.initialObjects
  const initialLineSelections = getInitialAngleLineSelections(
    context.initialSelectionIds,
    context.initialSelectionCoordinates,
    initialObjects
  )
  if (initialLineSelections) {
    const [firstSelection, secondSelection] = initialLineSelections
    const angleContext = getDimensionAngleContext(
      firstSelection,
      secondSelection,
      initialObjects
    )
    if (angleContext) {
      runtime.firstSelection = firstSelection
      runtime.angleContext = angleContext
      toastToolbar('Move mouse to choose sector, then click to place label.', {
        id: ANGLE_SECTOR_PROMPT_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
      })
      sendParent(self, {
        type: 'update hovered id',
        data: { hoveredId: null },
      })
      sendParent(self, {
        type: 'update selected ids',
        data: {
          selectedIds: [firstSelection.id, secondSelection.id],
          replaceExistingSelection: true,
          selectionCoordinates: {
            [firstSelection.id]: firstSelection.clickPoint,
            [secondSelection.id]: secondSelection.clickPoint,
          },
        },
      })
    }
  }

  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) {
        return
      }

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) {
        return
      }

      const mousePoint: Coords2d = [twoD.x, twoD.y]
      if (!runtime.firstSelection) {
        // First click: choose the first line and remember which side was clicked.
        const lineSelection = getClosestLineSelection(mousePoint, context)
        if (lineSelection) {
          runtime.firstSelection = lineSelection
          sendParent(self, {
            type: 'update selected ids',
            data: {
              selectedIds: [lineSelection.id],
              replaceExistingSelection: true,
              selectionCoordinates: {
                [lineSelection.id]: lineSelection.clickPoint,
              },
            },
          })
        }
      } else if (!runtime.angleContext) {
        // Second click: choose the second line and enter sector/label placement.
        const lineSelection = getClosestLineSelection(mousePoint, context)
        if (lineSelection && lineSelection.id !== runtime.firstSelection.id) {
          const angleContext = getDimensionAngleContext(
            runtime.firstSelection,
            lineSelection,
            initialObjects
          )

          if (angleContext) {
            runtime.angleContext = angleContext
            sendParent(self, {
              type: 'update hovered id',
              data: { hoveredId: null },
            })
            sendParent(self, {
              type: 'update selected ids',
              data: {
                selectedIds: [runtime.firstSelection.id, lineSelection.id],
                replaceExistingSelection: true,
                selectionCoordinates: {
                  [runtime.firstSelection.id]:
                    runtime.firstSelection.clickPoint,
                  [lineSelection.id]: lineSelection.clickPoint,
                },
              },
            })
            requestDraftPreview(runtime, context, self, mousePoint)
          }
        }
      } else {
        // Third click: place the label and commit the draft angle constraint.
        // If 2 lines were already selected when equipping, this is the first click.
        void commitDraftAngleConstraint(runtime, context, self, mousePoint)
      }
    },
    onMove: (args) => {
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) {
        sendParent(self, {
          type: 'update hovered id',
          data: { hoveredId: null },
        })
        return
      }

      const mousePoint: Coords2d = [twoD.x, twoD.y]
      if (runtime.angleContext) {
        // After both lines are selected, mouse movement updates the angle label draft.
        requestDraftPreview(runtime, context, self, mousePoint)
      } else {
        // Before the second line is selected, mouse movement only updates line hover.
        const lineSelection = getClosestLineSelection(mousePoint, context)
        sendParent(self, {
          type: 'update hovered id',
          data: { hoveredId: lineSelection?.id ?? null },
        })
      }
    },
  })
}

function removeDimensionListener({
  context,
}: { context: DimensionToolContext }) {
  deactivateRuntime(context.runtime)
  toastToolbar.dismiss(ANGLE_SECTOR_PROMPT_TOAST_ID)
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export const machine = setup({
  types: {
    context: {} as DimensionToolContext,
    events: {} as DimensionToolEvent,
    input: {} as DimensionToolInput,
  },
  actions: {
    'add dimension listener': addDimensionListener,
    'remove dimension listener': removeDimensionListener,
    'delete draft entities': ({ self }) =>
      sendParent(self, { type: 'delete draft entities' }),
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBECWBbMA7WqD2WABAC554A2AxAK5ZgCO1qADgNoAMAuoqM3rsXxYeIAB6J2AGhABPCQF950tJhxCSZcgDoAhgHcdqQViiEAZqgBOsYoT6osxSjogQ7eB8Q7ckIPgKERcQQANgAWMK0AZgB2AFYYgE4ADhD2AEYQqIzpOQQo9PStGOT00rCQxMqAJijkuMVlDGxcAg0KXQMjQlgwAGMCN3tHZ1d3T28RfyNA32DwyNiElLTM7PTcxDC45K1qkLKQ5OqYqLj09iiwxpAVFvVSDoBhAgtLdAdTCGa1AlhKCAEMBaBwANzwAGtgXdfkRHtoXlg3h8TIRvqpWjgEGC8H0dIICN5Jr5pgThHNEHF2DE9ok4md9tUIuFkmFNghkjFqtFUiztmV9jcYZj2gjXlYUV8fpj-mBLJY8JYtMxyPizIr0FphQ9NFpEcjPmjpUJYNisOC8WSiVwpvwZgQglt2OwtCF6TFnYkomd0tU4uzStyyhF0lFEtVEuxqqzFEoQFg8BA4CJtW14baAg6KQgALRhZLsnOhorpL0xLKJeLh-NC41p3X6QzGUxvGzjRwZ+3k0DBKIHLThj0FCJxMIxMKxdm1bkxX1pEpxJnjhpx1NwhtdWy9AZYIYeDsku1kx35EI0kfsKkT9Ie8MhdkRGnHN3bdiRirR66ruvr57i96Gui9x-J2x7Zt6NJemEzp+icfr3rIiAHJEYTVDeo6ltUfqJIktYYjqHS0AwTDMMwnygbMPYSAGZwDr6VLjuElaLrG8hAA */
  context: ({ input }): DimensionToolContext => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
    initialSelectionIds: input.initialSelectionIds ?? [],
    initialSelectionCoordinates: input.initialSelectionCoordinates ?? {},
    initialObjects:
      input.initialObjects ?? input.sceneGraphDelta?.new_graph.objects ?? [],
    runtime: createRuntime(),
  }),
  id: 'Dimension tool',
  initial: 'selecting lines',
  on: {
    unequip: {
      target: '#Dimension tool.unequipping',
      actions: 'delete draft entities',
    },
    escape: {
      target: '#Dimension tool.unequipping',
      actions: 'delete draft entities',
    },
  },
  description: 'Creates dimension constraints from sketch selections.',
  states: {
    'selecting lines': {
      entry: 'add dimension listener',
      on: {
        done: {
          target: 'unequipping',
        },
      },
      exit: 'remove dimension listener',
    },
    unequipping: {
      type: 'final',
      description: 'Any teardown logic should go here.',
    },
  },
})
