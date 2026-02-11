import type RustContext from '@src/lib/rustContext'
import type {
  SceneGraphDelta,
  SourceDelta,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import type { Coords2d } from '@src/lang/util'
import type { RectOriginMode } from '@src/machines/sketchSolve/tools/rectTool'
import { addVec, dot2d, scaleVec, subVec } from '@src/lib/utils2d'

type AppSettings = Awaited<ReturnType<typeof jsAppSettings>>
type NumericSuffix = ReturnType<typeof baseUnitToNumericSuffix>

export type RectDraftIds = {
  lineIds: [number, number, number, number]
  segmentIds: number[] // all segments, including points, lines
  constraintIds: number[]
}

function getLineFromDelta(
  sceneGraphDelta: SceneGraphDelta
): { lineId: number; startPointId: number; endPointId: number } | Error {
  const lineId = [...sceneGraphDelta.new_objects].reverse().find((objId) => {
    const obj = sceneGraphDelta.new_graph.objects[objId]
    return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
  })

  if (lineId === undefined) {
    return new Error(
      'Expected a Line segment to be created, but none was found'
    )
  }

  const lineObj = sceneGraphDelta.new_graph.objects[lineId]
  if (
    lineObj?.kind.type !== 'Segment' ||
    lineObj.kind.segment.type !== 'Line'
  ) {
    return new Error(
      'Expected Line object in scene graph delta, but did not find one'
    )
  }

  return {
    lineId,
    startPointId: lineObj.kind.segment.start,
    endPointId: lineObj.kind.segment.end,
  }
}

function getConstraintFromDelta(
  sceneGraphDelta: SceneGraphDelta
): number | Error {
  const constraintId = [...sceneGraphDelta.new_objects]
    .reverse()
    .find((objId) => {
      const obj = sceneGraphDelta.new_graph.objects[objId]
      return obj?.kind.type === 'Constraint'
    })

  if (constraintId === undefined) {
    return new Error(
      'Expected a Constraint to be created (coincident), but none was found'
    )
  }

  return constraintId
}

export async function createDraftRectangle({
  rustContext,
  kclManager,
  sketchId,
  mode,
}: {
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  mode: RectOriginMode
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  draft: RectDraftIds
}> {
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = await jsAppSettings(rustContext.settingsActor)

  const line1 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
  })
  const line2 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
  })
  const line3 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
  })
  const line4 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
  })

  /**
   *
   * This is how the rectangle looks like when drawn from bottom-left to top-right corner direction:
   *
   *  start4, end3      start3, end2
   *        o----line3----o
   *        |             |
   *      line4         line2
   *        |             |
   *        o----line1----o
   *  start1, end4      start2, end1
   *
   */
  const start1 = line1.startPointId
  const end1 = line1.endPointId
  const start2 = line2.startPointId
  const end2 = line2.endPointId
  const start3 = line3.startPointId
  const end3 = line3.endPointId
  const start4 = line4.startPointId
  const end4 = line4.endPointId

  const constraintIds: number[] = []

  // Connect corners (close loop): line1 -> line2 -> line3 -> line4 -> line1
  const c1 = await addCoincidentConstraint({
    a: end1,
    b: start2,
    rustContext,
    sketchId,
    settings,
  })
  const c2 = await addCoincidentConstraint({
    a: end2,
    b: start3,
    rustContext,
    sketchId,
    settings,
  })
  const c3 = await addCoincidentConstraint({
    a: end3,
    b: start4,
    rustContext,
    sketchId,
    settings,
  })
  const c0 = await addCoincidentConstraint({
    a: end4,
    b: start1,
    rustContext,
    sketchId,
    settings,
  })

  constraintIds.push(
    c1.constraintId,
    c2.constraintId,
    c3.constraintId,
    c0.constraintId
  )

  // Line constraints:
  // - Sides (line2/right, line4/left) are parallel
  // - Top/bottom (line3/top, line1/bottom) are parallel
  // - Bottom (line1) is perpendicular to right (line2)
  // - Top (line3) is horizontal (fixes overall orientation for axis-aligned modes)
  const parallelSides = await addTwoLineConstraint({
    type: 'Parallel',
    lines: [line2.lineId, line4.lineId],
    rustContext,
    sketchId,
    settings,
  })
  const parallelTopBottom = await addTwoLineConstraint({
    type: 'Parallel',
    lines: [line3.lineId, line1.lineId],
    rustContext,
    sketchId,
    settings,
  })
  const perpendicularBottomRight = await addTwoLineConstraint({
    type: 'Perpendicular',
    lines: [line1.lineId, line2.lineId],
    rustContext,
    sketchId,
    settings,
  })

  constraintIds.push(
    parallelSides.constraintId,
    parallelTopBottom.constraintId,
    perpendicularBottomRight.constraintId
  )

  let lastOperation = perpendicularBottomRight

  // Keep existing axis-aligned behavior for corner/center.
  // Angled mode omits this orientation lock so the rectangle can rotate.
  if (mode !== 'angled') {
    const topHorizontal = await addSingleLineConstraint({
      type: 'Horizontal',
      line: line3.lineId,
      rustContext,
      sketchId,
      settings,
    })
    constraintIds.push(topHorizontal.constraintId)
    lastOperation = topHorizontal
  }

  const segmentIds = [
    line1.lineId,
    line2.lineId,
    line3.lineId,
    line4.lineId,
    start1,
    end1,
    start2,
    end2,
    start3,
    end3,
    start4,
    end4,
  ]

  return {
    // Return the latest delta so the caller has all new ids
    kclSource: lastOperation.kclSource,
    sceneGraphDelta: lastOperation.sceneGraphDelta,
    draft: {
      lineIds: [line1.lineId, line2.lineId, line3.lineId, line4.lineId],
      segmentIds,
      constraintIds,
    },
  }
}

// Updates draft rectangle for center and corner rectangles.
export async function updateDraftRectangleAligned({
  rustContext,
  kclManager,
  sketchId,
  draft,
  rect,
}: {
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  draft: RectDraftIds
  rect: {
    min: Coords2d
    max: Coords2d
  }
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}> {
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = await jsAppSettings(rustContext.settingsActor)

  return updateDraftRectangleFromCorners({
    rustContext,
    sketchId,
    settings,
    draft,
    units,
    corners: getAxisAlignedRectangleCorners(rect),
  })
}

function getAxisAlignedRectangleCorners(rect: {
  min: Coords2d
  max: Coords2d
}): {
  start1: Coords2d
  start2: Coords2d
  start3: Coords2d
  start4: Coords2d
} {
  const start1: Coords2d = [rect.min[0], rect.min[1]]
  const start2: Coords2d = [rect.max[0], rect.min[1]]
  const start3: Coords2d = [rect.max[0], rect.max[1]]
  const start4: Coords2d = [rect.min[0], rect.max[1]]
  return { start1, start2, start3, start4 }
}

// Updates draft rectangle for angled (rotated) rectangle
export async function updateDraftRectangleAngled({
  rustContext,
  kclManager,
  sketchId,
  draft,
  p1,
  p2,
  p3,
}: {
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  draft: RectDraftIds
  p1: Coords2d
  p2: Coords2d
  p3: Coords2d
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}> {
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = await jsAppSettings(rustContext.settingsActor)

  return updateDraftRectangleFromCorners({
    rustContext,
    sketchId,
    settings,
    draft,
    units,
    corners: getAngledRectangleCorners({
      p1,
      p2,
      p3,
    }),
  })
}

// Returns a rotated rectangle from 3 points:
// - first 2 points define a side of the rectangle
// - third point defines the length of the other side of the rectangle
export function getAngledRectangleCorners({
  p1,
  p2,
  p3,
}: {
  p1: Coords2d
  p2: Coords2d
  p3: Coords2d
}): {
  start1: Coords2d
  start2: Coords2d
  start3: Coords2d
  start4: Coords2d
} {
  const side = subVec(p2, p1)
  const sideLength = Math.hypot(side[0], side[1])

  // Unit normal to the first side: rotate 90deg
  const normal: Coords2d = [-side[1] / sideLength, side[0] / sideLength]

  // Signed perpendicular distance from the third point to segment (p1, p2).
  const p1p3 = subVec(p3, p1)
  const offsetLength = dot2d(p1p3, normal)
  const offset = scaleVec(normal, offsetLength)

  const start1: Coords2d = p1
  const start2: Coords2d = p2
  const start3: Coords2d = addVec(p2, offset)
  const start4: Coords2d = addVec(p1, offset)

  return { start1, start2, start3, start4 }
}

async function updateDraftRectangleFromCorners({
  rustContext,
  sketchId,
  settings,
  draft,
  units,
  corners,
}: {
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
  draft: RectDraftIds
  units: NumericSuffix
  corners: {
    start1: Coords2d
    start2: Coords2d
    start3: Coords2d
    start4: Coords2d
  }
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}> {
  const [line1Id, line2Id, line3Id, line4Id] = draft.lineIds
  const { start1, start2, start3, start4 } = corners

  const edits = [
    {
      id: line1Id,
      ctor: makeLineSegmentCtor(start1, start2, units),
    },
    {
      id: line2Id,
      ctor: makeLineSegmentCtor(start2, start3, units),
    },
    {
      id: line3Id,
      ctor: makeLineSegmentCtor(start3, start4, units),
    },
    {
      id: line4Id,
      ctor: makeLineSegmentCtor(start4, start1, units),
    },
  ]

  return rustContext.editSegments(0, sketchId, edits, settings)
}

function makeVarExpr(value: number, units: NumericSuffix) {
  return {
    type: 'Var' as const,
    value: roundOff(value),
    units,
  }
}

function makeLineSegmentCtor(
  start: Coords2d,
  end: Coords2d,
  units: NumericSuffix
): SegmentCtor {
  return {
    type: 'Line',
    start: {
      x: makeVarExpr(start[0], units),
      y: makeVarExpr(start[1], units),
    },
    end: {
      x: makeVarExpr(end[0], units),
      y: makeVarExpr(end[1], units),
    },
  }
}

async function makeDraftLine({
  units,
  rustContext,
  sketchId,
  settings,
}: {
  units: NumericSuffix
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
}): Promise<{
  lineId: number
  startPointId: number
  endPointId: number
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}> {
  const ctor: SegmentCtor = {
    type: 'Line',
    // These are dummy values as they will be overridden by updateDraftRectangle immediately
    // If needed they can be sent as a param
    start: { x: makeVarExpr(0, units), y: makeVarExpr(0, units) },
    end: { x: makeVarExpr(10, units), y: makeVarExpr(0, units) },
  }
  const result = await rustContext.addSegment(
    0,
    sketchId,
    ctor,
    'rectangle-segment',
    settings
  )
  const line = getLineFromDelta(result.sceneGraphDelta)
  if (line instanceof Error) return Promise.reject(line)
  return {
    ...line,
    ...result,
  }
}

async function addCoincidentConstraint({
  a,
  b,
  rustContext,
  sketchId,
  settings,
}: {
  a: number
  b: number
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  constraintId: number
}> {
  const result = await rustContext.addConstraint(
    0,
    sketchId,
    { type: 'Coincident', segments: [a, b] },
    settings
  )
  const id = getConstraintFromDelta(result.sceneGraphDelta)
  if (id instanceof Error) return Promise.reject(id)
  return { ...result, constraintId: id }
}

async function addSingleLineConstraint({
  type,
  line,
  rustContext,
  sketchId,
  settings,
}: {
  type: 'Horizontal' | 'Vertical'
  line: number
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  constraintId: number
}> {
  const result = await rustContext.addConstraint(
    0,
    sketchId,
    { type, line },
    settings
  )
  const id = getConstraintFromDelta(result.sceneGraphDelta)
  if (id instanceof Error) return Promise.reject(id)
  return { ...result, constraintId: id }
}

async function addTwoLineConstraint({
  type,
  lines,
  rustContext,
  sketchId,
  settings,
}: {
  type: 'Parallel' | 'Perpendicular'
  lines: [number, number]
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  constraintId: number
}> {
  const result = await rustContext.addConstraint(
    0,
    sketchId,
    { type, lines },
    settings
  )
  const id = getConstraintFromDelta(result.sceneGraphDelta)
  if (id instanceof Error) return Promise.reject(id)
  return { ...result, constraintId: id }
}
