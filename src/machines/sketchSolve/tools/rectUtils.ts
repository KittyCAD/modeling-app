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

type AppSettings = Awaited<ReturnType<typeof jsAppSettings>>
type NumericSuffix = ReturnType<typeof baseUnitToNumericSuffix>

export type RectDraftIds = {
  lineIds: [number, number, number, number]
  segmentIds: number[]
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
  origin,
  rustContext,
  kclManager,
  sketchId,
}: {
  origin: Coords2d
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  draft: RectDraftIds
}> {
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = await jsAppSettings(rustContext.settingsActor)
  const [x, y] = origin

  const line1 = await makeDraftLine({
    x,
    y,
    units,
    rustContext,
    sketchId,
    settings,
  })
  const line2 = await makeDraftLine({
    x,
    y,
    units,
    rustContext,
    sketchId,
    settings,
  })
  const line3 = await makeDraftLine({
    x,
    y,
    units,
    rustContext,
    sketchId,
    settings,
  })
  const line4 = await makeDraftLine({
    x,
    y,
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
  // - Top (line3) is horizontal (fixes overall orientation)
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
  const topHorizontal = await addSingleLineConstraint({
    type: 'Horizontal',
    line: line3.lineId,
    rustContext,
    sketchId,
    settings,
  })
  constraintIds.push(
    parallelSides.constraintId,
    parallelTopBottom.constraintId,
    perpendicularBottomRight.constraintId,
    topHorizontal.constraintId
  )

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

  const lastOperation = topHorizontal

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

export async function updateDraftRectanglePoints({
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

  const [line1Id, line2Id, line3Id, line4Id] = draft.lineIds

  const start1: Coords2d = [rect.min[0], rect.min[1]]
  const start2: Coords2d = [rect.max[0], rect.min[1]]
  const start3: Coords2d = [rect.max[0], rect.max[1]]
  const start4: Coords2d = [rect.min[0], rect.max[1]]

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

  const result = await rustContext.editSegments(0, sketchId, edits, settings)

  return result
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
  x,
  y,
  units,
  rustContext,
  sketchId,
  settings,
}: {
  x: number
  y: number
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
    start: { x: makeVarExpr(0, units), y: makeVarExpr(0, units) },
    end: { x: makeVarExpr(11, units), y: makeVarExpr(11, units) },
  }
  const result = await rustContext.addSegment(
    0,
    sketchId,
    ctor,
    undefined, //'rectangle-segment',
    settings
  )
  const line = getLineFromDelta(result.sceneGraphDelta)
  if (line instanceof Error) return Promise.reject(line)
  return { ...line, ...result }
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
