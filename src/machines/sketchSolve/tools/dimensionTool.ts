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
import { roundOff } from '@src/lib/utils'
import {
  TAU,
  dot2d,
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
import type {
  SelectionClickPoints,
  SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import toast from 'react-hot-toast'
import { setup } from 'xstate'

type DimensionToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  initialSelectionIds: SketchSolveSelectionId[]
  initialSelectionClickPoints: SelectionClickPoints
  initialObjects: ApiObject[]
  runtime: DraftRuntime
}

type DimensionToolInput = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  initialSelectionIds?: SketchSolveSelectionId[]
  initialSelectionClickPoints?: SelectionClickPoints
  initialObjects?: ApiObject[]
  sceneGraphDelta?: SceneGraphDelta
}

type DimensionToolEvent =
  | BaseToolEvent
  | {
      type: 'done'
    }

type ParentSketchSolveEvent =
  | {
      type: 'update selected ids'
      data: {
        selectedIds?: SketchSolveSelectionId[]
        duringAreaSelectIds?: number[]
        replaceExistingSelection?: boolean
        selectionClickPoints?: SelectionClickPoints
      }
    }
  | {
      type: 'update hovered id'
      data: {
        hoveredId: SketchSolveSelectionId | null
      }
    }
  | {
      type: 'update sketch outcome'
      data: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
        updateEditor?: boolean
        writeToDisk?: boolean
        addToHistory?: boolean
        suppressExecOutcomeIssues?: boolean
      }
    }
  | {
      type: 'set draft entities'
      data: {
        segmentIds: number[]
        constraintIds: number[]
      }
    }
  | {
      type: 'clear draft entities'
    }
  | {
      type: 'delete draft entities'
    }

type LineSelection = {
  id: number
  clickPoint: Coords2d
}

type RayDirection = 'forward' | 'reverse'
export type AngleSector = 1 | 2 | 3 | 4
type AngleRayKey =
  | 'line0Forward'
  | 'line0Reverse'
  | 'line1Forward'
  | 'line1Reverse'

export type DimensionAngleDraftContext = {
  line0Id: number
  line1Id: number
  line0Direction: Coords2d
  line1Direction: Coords2d
  vertex: Coords2d
  baseWedgeIndex: number
}

type DimensionAngleSelection = {
  sector: AngleSector
  inverse: boolean
}

type AngleRay = {
  key: AngleRayKey
  direction: Coords2d
}

type AngleWedge = {
  start: AngleRay
  end: AngleRay
  selection: DimensionAngleSelection
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

const LINE_INTERSECTION_EPSILON = 1e-8
const SECTOR_EPSILON = 1e-9
const ANGLE_SECTOR_PROMPT_TOAST_ID = 'dimension-tool-angle-sector-prompt'

function getDefaultLengthUnit(kclManager: KclManager): NumericSuffix {
  return baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit ?? 'mm'
  )
}

function sendParent(
  self: { _parent?: { send: (event: unknown) => void } },
  event: ParentSketchSolveEvent
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

function showAngleSectorPrompt() {
  toast('Choose angle sector, then click to place the label.', {
    id: ANGLE_SECTOR_PROMPT_TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    position: 'top-center',
    style: {
      marginTop: '68px',
    },
  })
}

function dismissAngleSectorPrompt() {
  toast.dismiss(ANGLE_SECTOR_PROMPT_TOAST_ID)
}

function getObjects(context: DimensionToolContext) {
  return context.initialObjects
}

function getLineIntersection(
  line0Points: readonly [Coords2d, Coords2d],
  line1Points: readonly [Coords2d, Coords2d]
): Coords2d | null {
  const [p0, p1] = line0Points
  const [p2, p3] = line1Points
  const line0Direction = subVec(p1, p0)
  const line1Direction = subVec(p3, p2)
  const denominator =
    line0Direction[0] * line1Direction[1] -
    line0Direction[1] * line1Direction[0]

  if (Math.abs(denominator) < LINE_INTERSECTION_EPSILON) {
    return null
  }

  const delta = subVec(p2, p0)
  const t =
    (delta[0] * line1Direction[1] - delta[1] * line1Direction[0]) / denominator

  return [p0[0] + t * line0Direction[0], p0[1] + t * line0Direction[1]]
}

function getClickedRayDirection(
  linePoints: readonly [Coords2d, Coords2d],
  vertex: Coords2d,
  clickPoint: Coords2d
): RayDirection {
  const lineDirection = normalizeVec(subVec(linePoints[1], linePoints[0]))
  const clickDirection = subVec(clickPoint, vertex)
  return dot2d(clickDirection, lineDirection) >= 0 ? 'forward' : 'reverse'
}

export function getBaseAngleSector(
  line0Ray: RayDirection,
  line1Ray: RayDirection
): AngleSector {
  if (line0Ray === 'forward' && line1Ray === 'forward') {
    return 1
  }
  if (line0Ray === 'reverse' && line1Ray === 'forward') {
    return 2
  }
  if (line0Ray === 'reverse' && line1Ray === 'reverse') {
    return 3
  }
  return 4
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

  const line0Ray = getClickedRayDirection(
    line0Points,
    vertex,
    firstSelection.clickPoint
  )
  const line1Ray = getClickedRayDirection(
    line1Points,
    vertex,
    secondSelection.clickPoint
  )

  const angleContext = {
    line0Id: firstSelection.id,
    line1Id: secondSelection.id,
    line0Direction: normalizeVec(line0Vector),
    line1Direction: normalizeVec(line1Vector),
    vertex,
    baseWedgeIndex: 0,
  }
  angleContext.baseWedgeIndex = findWedgeIndexForRays(
    angleContext,
    getClickedRayKey(0, line0Ray),
    getClickedRayKey(1, line1Ray)
  )
  return angleContext
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
  selectionClickPoints: SelectionClickPoints,
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
        selectionClickPoints[lineIds[0]] ??
        getFarthestLinePointFromVertex(line0Points, vertex),
    },
    {
      id: lineIds[1],
      clickPoint:
        selectionClickPoints[lineIds[1]] ??
        getFarthestLinePointFromVertex(line1Points, vertex),
    },
  ]
}

function normalizeAngle(angle: number) {
  return ((angle % TAU) + TAU) % TAU
}

function getCcwSweep(start: Coords2d, end: Coords2d) {
  return normalizeAngle(
    Math.atan2(end[1], end[0]) - Math.atan2(start[1], start[0])
  )
}

function isDirectionInSector(
  direction: Coords2d,
  start: Coords2d,
  end: Coords2d
) {
  return (
    getCcwSweep(start, direction) <= getCcwSweep(start, end) + SECTOR_EPSILON
  )
}

function reverseDirection(direction: Coords2d): Coords2d {
  return scaleVec(direction, -1)
}

function getClickedRayKey(
  lineIndex: 0 | 1,
  direction: RayDirection
): AngleRayKey {
  if (lineIndex === 0) {
    return direction === 'forward' ? 'line0Forward' : 'line0Reverse'
  }
  return direction === 'forward' ? 'line1Forward' : 'line1Reverse'
}

export function getAngleSectorRays(
  angleContext: Pick<
    DimensionAngleDraftContext,
    'line0Direction' | 'line1Direction'
  >,
  sector: AngleSector
): [Coords2d, Coords2d] {
  switch (sector) {
    case 1:
      return [angleContext.line0Direction, angleContext.line1Direction]
    case 2:
      return [
        angleContext.line1Direction,
        reverseDirection(angleContext.line0Direction),
      ]
    case 3:
      return [
        reverseDirection(angleContext.line0Direction),
        reverseDirection(angleContext.line1Direction),
      ]
    case 4:
      return [
        reverseDirection(angleContext.line1Direction),
        angleContext.line0Direction,
      ]
  }
}

const DIRECT_SECTOR_BOUNDARIES = [
  {
    sector: 1,
    startKey: 'line0Forward',
    endKey: 'line1Forward',
  },
  {
    sector: 2,
    startKey: 'line1Forward',
    endKey: 'line0Reverse',
  },
  {
    sector: 3,
    startKey: 'line0Reverse',
    endKey: 'line1Reverse',
  },
  {
    sector: 4,
    startKey: 'line1Reverse',
    endKey: 'line0Forward',
  },
] as const satisfies ReadonlyArray<{
  sector: AngleSector
  startKey: AngleRayKey
  endKey: AngleRayKey
}>

function getAngleRays(
  angleContext: Pick<
    DimensionAngleDraftContext,
    'line0Direction' | 'line1Direction'
  >
): AngleRay[] {
  const rays: AngleRay[] = [
    { key: 'line0Forward', direction: angleContext.line0Direction },
    {
      key: 'line0Reverse',
      direction: reverseDirection(angleContext.line0Direction),
    },
    { key: 'line1Forward', direction: angleContext.line1Direction },
    {
      key: 'line1Reverse',
      direction: reverseDirection(angleContext.line1Direction),
    },
  ]

  return rays.sort(
    (left, right) =>
      normalizeAngle(Math.atan2(left.direction[1], left.direction[0])) -
      normalizeAngle(Math.atan2(right.direction[1], right.direction[0]))
  )
}

function getSelectionForWedge(startKey: AngleRayKey, endKey: AngleRayKey) {
  for (const boundary of DIRECT_SECTOR_BOUNDARIES) {
    if (boundary.startKey === startKey && boundary.endKey === endKey) {
      return {
        sector: boundary.sector,
        inverse: false,
      }
    }

    if (boundary.startKey === endKey && boundary.endKey === startKey) {
      return {
        sector: boundary.sector,
        inverse: true,
      }
    }
  }
}

function getAngleWedges(
  angleContext: Pick<
    DimensionAngleDraftContext,
    'line0Direction' | 'line1Direction'
  >
): AngleWedge[] {
  const rays = getAngleRays(angleContext)
  const wedges: AngleWedge[] = []

  for (let index = 0; index < rays.length; index++) {
    const start = rays[index]
    const end = rays[(index + 1) % rays.length]
    const selection = getSelectionForWedge(start.key, end.key)
    if (selection) {
      wedges.push({ start, end, selection })
    }
  }

  return wedges
}

function findWedgeIndexForRays(
  angleContext: Pick<
    DimensionAngleDraftContext,
    'line0Direction' | 'line1Direction'
  >,
  line0Ray: AngleRayKey,
  line1Ray: AngleRayKey
) {
  const wedges = getAngleWedges(angleContext)
  return Math.max(
    wedges.findIndex(
      (wedge) =>
        (wedge.start.key === line0Ray && wedge.end.key === line1Ray) ||
        (wedge.start.key === line1Ray && wedge.end.key === line0Ray)
    ),
    0
  )
}

function getBaseWedgeIndex(angleContext: DimensionAngleDraftContext): number {
  return angleContext.baseWedgeIndex
}

function getHoveredWedgeIndex(
  mousePoint: Coords2d,
  angleContext: DimensionAngleDraftContext
): number {
  const mouseDirection = subVec(mousePoint, angleContext.vertex)
  if (length2d(mouseDirection) === 0) {
    return getBaseWedgeIndex(angleContext)
  }

  const wedges = getAngleWedges(angleContext)
  const hoveredIndex = wedges.findIndex((wedge) =>
    isDirectionInSector(
      mouseDirection,
      wedge.start.direction,
      wedge.end.direction
    )
  )
  if (hoveredIndex !== -1) {
    return hoveredIndex
  }

  return getBaseWedgeIndex(angleContext)
}

function invertAngleSelection(
  selection: DimensionAngleSelection
): DimensionAngleSelection {
  return {
    sector: selection.sector,
    inverse: !selection.inverse,
  }
}

function getOppositeWedgeIndex(wedgeIndex: number) {
  return (wedgeIndex + 2) % 4
}

function getWedgeSelection(
  angleContext: DimensionAngleDraftContext,
  wedgeIndex: number
) {
  const wedges = getAngleWedges(angleContext)
  return (
    wedges[wedgeIndex]?.selection ??
    wedges[getBaseWedgeIndex(angleContext)]?.selection
  )
}

export function getDimensionAngleSelection(
  mousePoint: Coords2d,
  angleContext: DimensionAngleDraftContext
): DimensionAngleSelection {
  const baseWedgeIndex = getBaseWedgeIndex(angleContext)
  const hoveredWedgeIndex = getHoveredWedgeIndex(mousePoint, angleContext)
  const baseSelection = getWedgeSelection(angleContext, baseWedgeIndex)

  if (
    baseSelection &&
    hoveredWedgeIndex === getOppositeWedgeIndex(baseWedgeIndex)
  ) {
    return invertAngleSelection(baseSelection)
  }

  const hoveredSelection = getWedgeSelection(angleContext, hoveredWedgeIndex)
  if (hoveredSelection) {
    return hoveredSelection
  }

  return {
    sector: 1,
    inverse: false,
  }
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

async function deleteDraftConstraint(
  runtime: DraftRuntime,
  context: DimensionToolContext
) {
  if (runtime.draftConstraintId === null) {
    return
  }

  await context.rustContext.deleteObjects(
    SKETCH_FILE_VERSION,
    context.sketchId,
    [runtime.draftConstraintId],
    [],
    jsAppSettings(context.rustContext.settingsActor),
    false
  )
  runtime.draftConstraintId = null
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
  self: { _parent?: { send: (event: unknown) => void } },
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

function sendFinalResultToParent(
  self: { _parent?: { send: (event: unknown) => void } },
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
    },
  })
}

async function replaceDraftAngleConstraint(
  runtime: DraftRuntime,
  context: DimensionToolContext,
  self: { _parent?: { send: (event: unknown) => void } },
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
  self: { _parent?: { send: (event: unknown) => void } },
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
        await replaceDraftAngleConstraint(
          runtime,
          context,
          self,
          nextMousePoint
        )
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
  self: {
    _parent?: { send: (event: unknown) => void }
    send: (event: DimensionToolEvent) => void
  },
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
    await deleteDraftConstraint(runtime, context)
    const result = await context.rustContext.addConstraint(
      SKETCH_FILE_VERSION,
      context.sketchId,
      constraint,
      jsAppSettings(context.rustContext.settingsActor),
      true
    )

    const constraintId = getConstraintIdFromResult(result)
    sendFinalResultToParent(self, result)
    sendParent(self, { type: 'clear draft entities' })
    sendParent(self, {
      type: 'update selected ids',
      data: { selectedIds: [], duringAreaSelectIds: [] },
    })
    sendParent(self, {
      type: 'update hovered id',
      data: { hoveredId: constraintId },
    })
    dismissAngleSectorPrompt()
    self.send({ type: 'done' })
  } catch (error) {
    toastSketchSolveError(error)
  }
}

function getClosestLineSelection(
  mousePoint: Coords2d,
  context: DimensionToolContext
): LineSelection | null {
  const objects = getObjects(context)
  const currentSketchObjects = getCurrentSketchObjectsById(
    objects,
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
  self: {
    _parent?: { send: (event: unknown) => void }
    send: (event: DimensionToolEvent) => void
  }
}) {
  const runtime = context.runtime
  runtime.active = true
  const initialLineSelections = getInitialAngleLineSelections(
    context.initialSelectionIds,
    context.initialSelectionClickPoints,
    getObjects(context)
  )
  if (initialLineSelections) {
    const [firstSelection, secondSelection] = initialLineSelections
    const angleContext = getDimensionAngleContext(
      firstSelection,
      secondSelection,
      getObjects(context)
    )
    if (angleContext) {
      runtime.firstSelection = firstSelection
      runtime.angleContext = angleContext
      showAngleSectorPrompt()
      sendParent(self, {
        type: 'update hovered id',
        data: { hoveredId: null },
      })
      sendParent(self, {
        type: 'update selected ids',
        data: {
          selectedIds: [firstSelection.id, secondSelection.id],
          replaceExistingSelection: true,
          selectionClickPoints: {
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
              selectionClickPoints: {
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
            getObjects(context)
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
                selectionClickPoints: {
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
        requestDraftPreview(runtime, context, self, mousePoint)
        return
      }

      const lineSelection = getClosestLineSelection(mousePoint, context)
      sendParent(self, {
        type: 'update hovered id',
        data: { hoveredId: lineSelection?.id ?? null },
      })
    },
  })
}

function removeDimensionListener({
  context,
}: { context: DimensionToolContext }) {
  deactivateRuntime(context.runtime)
  dismissAngleSectorPrompt()
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

function deleteDraftEntities(self: {
  _parent?: { send: (event: unknown) => void }
}) {
  sendParent(self, { type: 'delete draft entities' })
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
    'delete draft entities': ({ self }) => deleteDraftEntities(self),
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
  },
}).createMachine({
  context: ({ input }): DimensionToolContext => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
    initialSelectionIds: input.initialSelectionIds ?? [],
    initialSelectionClickPoints: input.initialSelectionClickPoints ?? {},
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
