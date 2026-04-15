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
import {
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  type SnapTarget,
  getConstraintForSnapTarget,
} from '@src/machines/sketchSolve/snapping'
import { MIN_DRAFT_GEOMETRY_DELTA_MM } from '@src/machines/sketchSolve/tools/draftGeometryPolicy'

type AppSettings = Awaited<ReturnType<typeof jsAppSettings>>
type NumericSuffix = ReturnType<typeof baseUnitToNumericSuffix>

export type RectDraftIds = {
  lineIds: [number, number, number, number]
  segmentIds: number[] // all segments, including points, lines
  constraintIds: number[]
  originPointId: number
  centerGeometry?: {
    diagonalLineIds: [number, number]
    diagonalPointIds: [number, number, number, number]
    centerPointId: number
  }
}

const INITIAL_CENTER_RECT_HALF_SIZE = 5
const INITIAL_CORNER_RECT_SIZE = MIN_DRAFT_GEOMETRY_DELTA_MM

function getLineFromDelta(
  sceneGraphDelta: SceneGraphDelta
): { lineId: number; startPointId: number; endPointId: number } | Error {
  const lineId = [...sceneGraphDelta.new_objects].reverse().find((objId) => {
    const obj = sceneGraphDelta.new_graph.objects[objId]
    return isLineSegment(obj)
  })

  if (lineId === undefined) {
    return new Error(
      'Expected a Line segment to be created, but none was found'
    )
  }

  const lineObj = sceneGraphDelta.new_graph.objects[lineId]
  if (!isLineSegment(lineObj)) {
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

function getPointFromDelta(
  sceneGraphDelta: SceneGraphDelta
): { pointId: number } | Error {
  const pointId = [...sceneGraphDelta.new_objects].reverse().find((objId) => {
    const obj = sceneGraphDelta.new_graph.objects[objId]
    return isPointSegment(obj)
  })

  if (pointId === undefined) {
    return new Error(
      'Expected a Point segment to be created, but none was found'
    )
  }

  return { pointId }
}

export async function createDraftRectangle({
  rustContext,
  kclManager,
  sketchId,
  mode,
  origin = [0, 0],
  snapTarget,
}: {
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  mode: RectOriginMode
  origin?: Coords2d
  snapTarget?: SnapTarget
}): Promise<{
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  draft: RectDraftIds
}> {
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )
  const settings = jsAppSettings(rustContext.settingsActor)
  const draftCorners = getInitialDraftRectangleCorners(origin, mode)

  const centerPoint =
    mode === 'center'
      ? await makeDraftPoint({
          units,
          rustContext,
          sketchId,
          settings,
          position: origin,
        })
      : null

  const line1 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
    start: draftCorners.start1,
    end: draftCorners.start2,
  })
  const line2 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
    start: draftCorners.start2,
    end: draftCorners.start3,
  })
  const line3 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
    start: draftCorners.start3,
    end: draftCorners.start4,
  })
  const line4 = await makeDraftLine({
    units,
    rustContext,
    sketchId,
    settings,
    start: draftCorners.start4,
    end: draftCorners.start1,
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
  let centerGeometry: RectDraftIds['centerGeometry']
  const originPointId = centerPoint?.pointId ?? start1

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

  if (mode === 'center' && centerPoint) {
    const diagonal1 = await makeDraftLine({
      units,
      rustContext,
      sketchId,
      settings,
      construction: true,
      start: draftCorners.start1,
      end: draftCorners.start3,
    })
    const diagonal2 = await makeDraftLine({
      units,
      rustContext,
      sketchId,
      settings,
      construction: true,
      start: draftCorners.start2,
      end: draftCorners.start4,
    })

    const diagonalStartCoincident = await addCoincidentConstraint({
      a: diagonal1.startPointId,
      b: start1,
      rustContext,
      sketchId,
      settings,
    })
    const diagonalEndCoincident = await addCoincidentConstraint({
      a: diagonal1.endPointId,
      b: end2,
      rustContext,
      sketchId,
      settings,
    })
    const opposingDiagonalStartCoincident = await addCoincidentConstraint({
      a: diagonal2.startPointId,
      b: end1,
      rustContext,
      sketchId,
      settings,
    })
    const opposingDiagonalEndCoincident = await addCoincidentConstraint({
      a: diagonal2.endPointId,
      b: start4,
      rustContext,
      sketchId,
      settings,
    })
    const centerOnDiagonal1 = await addCoincidentConstraint({
      a: centerPoint.pointId,
      b: diagonal1.lineId,
      rustContext,
      sketchId,
      settings,
    })
    const centerOnDiagonal2 = await addCoincidentConstraint({
      a: centerPoint.pointId,
      b: diagonal2.lineId,
      rustContext,
      sketchId,
      settings,
    })
    const equalDiagonals = await addTwoLineConstraint({
      type: 'LinesEqualLength',
      lines: [diagonal1.lineId, diagonal2.lineId],
      rustContext,
      sketchId,
      settings,
    })

    constraintIds.push(
      diagonalStartCoincident.constraintId,
      diagonalEndCoincident.constraintId,
      opposingDiagonalStartCoincident.constraintId,
      opposingDiagonalEndCoincident.constraintId,
      centerOnDiagonal1.constraintId,
      centerOnDiagonal2.constraintId,
      equalDiagonals.constraintId
    )

    centerGeometry = {
      diagonalLineIds: [diagonal1.lineId, diagonal2.lineId],
      diagonalPointIds: [
        diagonal1.startPointId,
        diagonal1.endPointId,
        diagonal2.startPointId,
        diagonal2.endPointId,
      ],
      centerPointId: centerPoint.pointId,
    }

    lastOperation = equalDiagonals
  }

  const snapConstraint = getConstraintForSnapTarget(
    originPointId,
    snapTarget,
    units
  )
  if (snapConstraint !== null) {
    const snapResult = await rustContext.addConstraint(
      0,
      sketchId,
      snapConstraint,
      settings
    )
    const snapConstraintId = getConstraintFromDelta(snapResult.sceneGraphDelta)
    if (snapConstraintId instanceof Error) {
      return Promise.reject(snapConstraintId)
    }
    constraintIds.push(snapConstraintId)
    lastOperation = {
      ...snapResult,
      constraintId: snapConstraintId,
    }
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

  if (centerGeometry) {
    const [diagonal1Id, diagonal2Id] = centerGeometry.diagonalLineIds
    const [
      diagonal1StartPointId,
      diagonal1EndPointId,
      diagonal2StartPointId,
      diagonal2EndPointId,
    ] = centerGeometry.diagonalPointIds
    segmentIds.push(
      diagonal1Id,
      diagonal2Id,
      centerGeometry.centerPointId,
      diagonal1StartPointId,
      diagonal1EndPointId,
      diagonal2StartPointId,
      diagonal2EndPointId
    )
  }

  return {
    // Return the latest delta so the caller has all new ids
    kclSource: lastOperation.kclSource,
    sceneGraphDelta: lastOperation.sceneGraphDelta,
    draft: {
      lineIds: [line1.lineId, line2.lineId, line3.lineId, line4.lineId],
      segmentIds,
      constraintIds,
      originPointId,
      centerGeometry,
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
  const settings = jsAppSettings(rustContext.settingsActor)

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

function getCenteredDraftRectangleCorners(
  center: Coords2d,
  halfSize: number
): {
  start1: Coords2d
  start2: Coords2d
  start3: Coords2d
  start4: Coords2d
} {
  return getAxisAlignedRectangleCorners({
    min: [center[0] - halfSize, center[1] - halfSize],
    max: [center[0] + halfSize, center[1] + halfSize],
  })
}

function getInitialDraftRectangleCorners(
  origin: Coords2d,
  mode: RectOriginMode
): {
  start1: Coords2d
  start2: Coords2d
  start3: Coords2d
  start4: Coords2d
} {
  if (mode === 'center') {
    return getCenteredDraftRectangleCorners(
      origin,
      INITIAL_CENTER_RECT_HALF_SIZE
    )
  }

  return getAxisAlignedRectangleCorners({
    min: origin,
    max: [
      origin[0] + INITIAL_CORNER_RECT_SIZE,
      origin[1] + INITIAL_CORNER_RECT_SIZE,
    ],
  })
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
  const settings = jsAppSettings(rustContext.settingsActor)

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
  if (sideLength === 0) {
    return getAxisAlignedRectangleCorners({
      min: p1,
      max: [p1[0] + INITIAL_CORNER_RECT_SIZE, p1[1] + INITIAL_CORNER_RECT_SIZE],
    })
  }

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

export function getAngledRectangleWidth({
  p1,
  p2,
  p3,
}: {
  p1: Coords2d
  p2: Coords2d
  p3: Coords2d
}): number {
  const side = subVec(p2, p1)
  const sideLength = Math.hypot(side[0], side[1])
  if (sideLength === 0) {
    return 0
  }

  const normal: Coords2d = [-side[1] / sideLength, side[0] / sideLength]
  return dot2d(subVec(p3, p1), normal)
}

export function getSeededAngledRectangleThirdPoint(
  p1: Coords2d,
  p2: Coords2d,
  width = MIN_DRAFT_GEOMETRY_DELTA_MM
): Coords2d {
  const side = subVec(p2, p1)
  const sideLength = Math.hypot(side[0], side[1])
  if (sideLength === 0) {
    return [p2[0], p2[1] + width]
  }

  const normal: Coords2d = [-side[1] / sideLength, side[0] / sideLength]
  return addVec(p2, scaleVec(normal, width))
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
  const center: Coords2d = [
    (start1[0] + start3[0]) / 2,
    (start1[1] + start3[1]) / 2,
  ]

  const edits: Array<{ id: number; ctor: SegmentCtor }> = [
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

  if (draft.centerGeometry) {
    const [diagonal1Id, diagonal2Id] = draft.centerGeometry.diagonalLineIds
    edits.push(
      {
        id: diagonal1Id,
        ctor: makeLineSegmentCtor(start1, start3, units, {
          construction: true,
        }),
      },
      {
        id: diagonal2Id,
        ctor: makeLineSegmentCtor(start2, start4, units, {
          construction: true,
        }),
      },
      {
        id: draft.centerGeometry.centerPointId,
        ctor: makePointSegmentCtor(center, units),
      }
    )
  }

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
  units: NumericSuffix,
  options?: {
    construction?: boolean
  }
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
    ...(options?.construction ? { construction: true } : {}),
  }
}

function makePointSegmentCtor(
  position: Coords2d,
  units: NumericSuffix
): SegmentCtor {
  return {
    type: 'Point',
    position: {
      x: makeVarExpr(position[0], units),
      y: makeVarExpr(position[1], units),
    },
  }
}

async function makeDraftLine({
  units,
  rustContext,
  sketchId,
  settings,
  start,
  end,
  construction = false,
}: {
  units: NumericSuffix
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
  start?: Coords2d
  end?: Coords2d
  construction?: boolean
}): Promise<{
  lineId: number
  startPointId: number
  endPointId: number
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}> {
  const ctor = makeLineSegmentCtor(
    start ?? [0, 0],
    end ?? [10, 0],
    units,
    construction ? { construction: true } : undefined
  )
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

async function makeDraftPoint({
  units,
  rustContext,
  sketchId,
  settings,
  position,
}: {
  units: NumericSuffix
  rustContext: RustContext
  sketchId: number
  settings: AppSettings
  position: Coords2d
}): Promise<{
  pointId: number
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}> {
  const result = await rustContext.addSegment(
    0,
    sketchId,
    makePointSegmentCtor(position, units),
    'rectangle-center-point',
    settings
  )
  const point = getPointFromDelta(result.sceneGraphDelta)
  if (point instanceof Error) return Promise.reject(point)
  return {
    ...point,
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
    type === 'Horizontal'
      ? { type: 'Horizontal', Line: { line_id: line } }
      : { type: 'Vertical', Line: { line_id: line } },
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
  type: 'Parallel' | 'Perpendicular' | 'LinesEqualLength'
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
