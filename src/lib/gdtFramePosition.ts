import { queryModelingCommand } from '@src/lib/engineConnection/utils'
import type { BoundingBox, FaceIsPlanar, Point3d } from '@kittycad/lib'

import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createArrayExpression, createLiteral } from '@src/lang/create'
import { toUtf16 } from '@src/lang/errors'
import { getSketchBlockForArtifact } from '@src/lang/std/artifactGraph'
import { isEnginePrimitiveSelection } from '@src/lang/queryAst'
import { defaultPlaneNameToKcl } from '@src/lib/planes'
import type {
  ArtifactId,
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  Program,
} from '@src/lang/wasm'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  KCL_PLANE_XY,
  KCL_PLANE_XZ,
  KCL_PLANE_YZ,
} from '@src/lib/constants'
import { baseUnitToMm, isArray, roundOff } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'

type Axis = 'x' | 'y' | 'z'
type GdtFramePlane =
  | typeof KCL_PLANE_XY
  | typeof KCL_PLANE_XZ
  | typeof KCL_PLANE_YZ
type GdtFramePositionSigns = readonly [number, number]
type GdtFrameDefaultsFromNormal = {
  framePlane: GdtFramePlane
  framePositionSigns: GdtFramePositionSigns
}

const AXIS_INFERENCE_TOLERANCE = 0.05
const AXES: Axis[] = ['x', 'y', 'z']

type GdtCommandData =
  | ModelingCommandSchema['GDT Flatness']
  | ModelingCommandSchema['GDT Datum']
  | ModelingCommandSchema['GDT Position']
  | ModelingCommandSchema['GDT Profile']
  | ModelingCommandSchema['GDT Distance']
  | ModelingCommandSchema['GDT Perpendicularity']
  | ModelingCommandSchema['GDT Angularity']
  | ModelingCommandSchema['GDT Concentricity']
  | ModelingCommandSchema['GDT Symmetry']
  | ModelingCommandSchema['GDT Parallelism']
  | ModelingCommandSchema['GDT Annotation']

export const GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO = 0.07

function getSelectionsFromGdtData(
  data: GdtCommandData
): Selections | undefined {
  if ('objects' in data) {
    return data.objects
  }
  if ('faces' in data) {
    return data.faces
  }
  return undefined
}

function visitAstNodes(value: unknown, onNode: (node: unknown) => void): void {
  if (typeof value !== 'object' || value === null) {
    return
  }

  onNode(value)

  if (isArray(value)) {
    value.forEach((item) => visitAstNodes(item, onNode))
    return
  }

  Object.values(value).forEach((item) => visitAstNodes(item, onNode))
}

function isGdtCall(node: unknown): node is Node<CallExpressionKw> {
  if (
    typeof node !== 'object' ||
    node === null ||
    !('type' in node) ||
    node.type !== 'CallExpressionKw' ||
    !('callee' in node)
  ) {
    return false
  }

  const callee = node.callee
  if (
    typeof callee !== 'object' ||
    callee === null ||
    !('type' in callee) ||
    callee.type !== 'Name' ||
    !('path' in callee)
  ) {
    return false
  }

  const path = callee.path
  if (!isArray(path) || path.length !== 1) {
    return false
  }

  const firstPathEntry = path[0]
  return (
    typeof firstPathEntry === 'object' &&
    firstPathEntry !== null &&
    'name' in firstPathEntry &&
    firstPathEntry.name === 'gdt'
  )
}

function getSourceTextForExpr(
  expr: Expr,
  sourceCode: string | undefined
): string | undefined {
  if (
    sourceCode &&
    Number.isFinite(expr.start) &&
    Number.isFinite(expr.end) &&
    expr.end > expr.start
  ) {
    return sourceCode
      .slice(toUtf16(expr.start, sourceCode), toUtf16(expr.end, sourceCode))
      .trim()
  }

  if (expr.type === 'Literal') {
    return expr.raw
  }

  if (expr.type === 'Name') {
    return [...expr.path.map(({ name }) => name), expr.name.name].join('::')
  }

  return undefined
}

export function getExistingGdtFontSize(
  ast: Node<Program> | undefined,
  sourceCode?: string
): KclCommandValue | undefined {
  if (!ast) {
    return undefined
  }

  let fontSize: KclCommandValue | undefined

  visitAstNodes(ast, (node) => {
    if (!isGdtCall(node)) {
      return
    }

    const fontSizeArg = node.arguments?.find(
      (arg) => arg.label?.name === 'fontSize'
    )
    if (!fontSizeArg) {
      return
    }

    const valueText = getSourceTextForExpr(fontSizeArg.arg, sourceCode)
    if (!valueText) {
      return
    }

    fontSize = {
      valueAst: structuredClone(fontSizeArg.arg),
      valueCalculated: valueText,
      valueText,
    }
  })

  return fontSize
}

function deduplicateArtifactIds(entityIds: ArtifactId[]): ArtifactId[] {
  return [...new Set(entityIds)]
}

export function getEngineEntityIdsForGdtSelections(
  selections: Selections | undefined
): ArtifactId[] {
  if (!selections) {
    return []
  }

  const entityIds = selections.graphSelections.flatMap((selection) => {
    if (selection.engineEntityId) {
      return [selection.engineEntityId]
    }
    if (selection.entityRef?.type === 'face') {
      return [selection.entityRef.face_id]
    }

    const artifact = selection.artifact
    if (!artifact?.id) {
      return []
    }

    if (artifact.type !== 'pattern') {
      return [artifact.id]
    }

    return [
      ...artifact.copyIds,
      ...artifact.copyFaceIds,
      ...artifact.copyEdgeIds,
    ]
  })

  const primitiveIds = selections.otherSelections.flatMap((selection) =>
    typeof selection === 'object' &&
    'type' in selection &&
    selection.type === 'enginePrimitive' &&
    (selection.primitiveType === 'edge' || selection.primitiveType === 'face')
      ? [selection.entityId]
      : []
  )
  return deduplicateArtifactIds([...entityIds, ...primitiveIds])
}

export function getPlanarFaceEntityIdsForGdtSelections(
  selections: Selections | undefined
): ArtifactId[] {
  if (!selections) {
    return []
  }

  const entityIds = selections.graphSelections.flatMap((selection) => {
    const artifact = selection.artifact

    if (artifact?.type === 'pattern') {
      return artifact.copyFaceIds
    }

    if (
      artifact?.type === 'cap' ||
      artifact?.type === 'wall' ||
      artifact?.type === 'primitiveFace'
    ) {
      return [selection.engineEntityId ?? artifact.id]
    }

    if (artifact?.type === 'edgeCut') {
      return [artifact.surfaceId, selection.engineEntityId, artifact.id].filter(
        (id): id is ArtifactId => Boolean(id)
      )
    }

    return []
  })

  return deduplicateArtifactIds(entityIds)
}

function getDecisiveAxis(
  values: Record<Axis, number>,
  compare: (left: number, right: number) => number
): Axis | undefined {
  const sortedAxes = [...AXES].sort((left, right) =>
    compare(values[left], values[right])
  )
  const bestAxis = sortedAxes[0]
  const nextAxis = sortedAxes[1]
  if (!bestAxis || !nextAxis) {
    return undefined
  }

  const bestValue = values[bestAxis]
  const nextValue = values[nextAxis]
  if (!Number.isFinite(bestValue) || !Number.isFinite(nextValue)) {
    return undefined
  }

  const scale = Math.max(...Object.values(values).map(Math.abs), 1)
  if (Math.abs(bestValue - nextValue) <= scale * AXIS_INFERENCE_TOLERANCE) {
    return undefined
  }

  return bestAxis
}

function getFeaturePlaneForNormalAxis(axis: Axis): GdtFramePlane {
  if (axis === 'x') {
    return KCL_PLANE_YZ
  }
  if (axis === 'y') {
    return KCL_PLANE_XZ
  }
  return KCL_PLANE_XY
}

function getFramePlaneForFeaturePlane(
  featurePlane: GdtFramePlane
): GdtFramePlane {
  if (featurePlane === KCL_PLANE_XY) {
    return KCL_PLANE_XZ
  }
  return KCL_PLANE_XY
}

function getDominantNormalAxis(normal: Point3d): Axis | undefined {
  return getDecisiveAxis(
    {
      x: Math.abs(normal.x),
      y: Math.abs(normal.y),
      z: Math.abs(normal.z),
    },
    (left, right) => right - left
  )
}

export function getDefaultGdtFramePlaneFromNormal(
  normal: Point3d
): GdtFramePlane | undefined {
  const axis = getDominantNormalAxis(normal)
  if (!axis) {
    return undefined
  }

  return getFramePlaneForFeaturePlane(getFeaturePlaneForNormalAxis(axis))
}

export function getDefaultGdtFramePositionSignsFromNormal(
  normal: Point3d
): GdtFramePositionSigns | undefined {
  const axis = getDominantNormalAxis(normal)
  if (!axis) {
    return undefined
  }

  if (axis === 'x') {
    return [normal.x >= 0 ? 1 : -1, 1]
  }
  if (axis === 'y') {
    return [1, normal.y >= 0 ? 1 : -1]
  }

  return [1, normal.z >= 0 ? 1 : -1]
}

function getDefaultGdtFrameDefaultsFromNormal(
  normal: Point3d
): GdtFrameDefaultsFromNormal | undefined {
  const framePlane = getDefaultGdtFramePlaneFromNormal(normal)
  const framePositionSigns = getDefaultGdtFramePositionSignsFromNormal(normal)

  if (!framePlane || !framePositionSigns) {
    return undefined
  }

  return {
    framePlane,
    framePositionSigns,
  }
}

export function getDefaultGdtFramePlaneFromBoundingBox(
  dimensions: BoundingBox['dimensions']
): GdtFramePlane | undefined {
  const axis = getDecisiveAxis(
    {
      x: dimensions.x,
      y: dimensions.y,
      z: dimensions.z,
    },
    (left, right) => left - right
  )
  if (!axis) {
    return undefined
  }

  return getFramePlaneForFeaturePlane(getFeaturePlaneForNormalAxis(axis))
}

export function getAverageBoundingBoxDimension(
  dimensions: BoundingBox['dimensions']
): number | undefined {
  const nonZeroDimensions = [dimensions.x, dimensions.y, dimensions.z].filter(
    (dimension) => Number.isFinite(dimension) && dimension > 0
  )

  if (nonZeroDimensions.length === 0) {
    return undefined
  }

  return roundOff(
    nonZeroDimensions.reduce((sum, dimension) => sum + dimension, 0) /
      nonZeroDimensions.length,
    4
  )
}

function createFramePositionCommandValue(
  xValue: number,
  yValue: number,
  wasmInstance: ModuleType
): KclCommandValue {
  const valueText = `[${xValue}, ${yValue}]`
  return {
    valueAst: createArrayExpression([
      createLiteral(xValue, wasmInstance),
      createLiteral(yValue, wasmInstance),
    ]),
    valueCalculated: valueText,
    valueText,
  }
}

function createFontSizeCommandValue(
  averageDimension: number,
  outputUnit: UnitLength,
  wasmInstance: ModuleType
): KclCommandValue {
  const value = roundOff(
    averageDimension * GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO,
    4
  )
  const valueAst = createLiteral(
    value,
    wasmInstance,
    baseUnitToNumericSuffix(outputUnit),
    4
  )
  const valueText = valueAst.raw

  return {
    valueAst,
    valueCalculated: valueText,
    valueText,
  }
}

function getNormalFromPlanarFace(face: FaceIsPlanar): Point3d | undefined {
  const normal = face.z_axis
  if (
    !normal ||
    !Number.isFinite(normal.x) ||
    !Number.isFinite(normal.y) ||
    !Number.isFinite(normal.z) ||
    (normal.x === 0 && normal.y === 0 && normal.z === 0)
  ) {
    return undefined
  }

  return normal
}

async function getPlanarFaceNormal(
  engine: ConnectionManager,
  entityId: ArtifactId
): Promise<Point3d | undefined> {
  const response = await queryModelingCommand(engine, {
    type: 'face_is_planar',
    object_id: entityId,
  })
  return response?.type === 'face_is_planar'
    ? getNormalFromPlanarFace(response.data)
    : undefined
}

async function getDefaultGdtFrameDefaultsFromSelectionNormals({
  engineCommandManager,
  selections,
}: {
  engineCommandManager: ConnectionManager
  selections: Selections | undefined
}): Promise<GdtFrameDefaultsFromNormal | undefined> {
  const faceEntityIds = getPlanarFaceEntityIdsForGdtSelections(selections)

  for (const entityId of faceEntityIds) {
    const normal = await getPlanarFaceNormal(engineCommandManager, entityId)
    if (!normal) {
      continue
    }

    const defaults = getDefaultGdtFrameDefaultsFromNormal(normal)
    if (defaults) {
      return defaults
    }
  }

  return undefined
}

async function getBoundingBoxForGdtEntities({
  engineCommandManager,
  entityIds,
  outputUnit,
  includeEntireScene = false,
}: {
  engineCommandManager: ConnectionManager
  entityIds: ArtifactId[]
  outputUnit: UnitLength
  includeEntireScene?: boolean
}): Promise<BoundingBox | undefined> {
  if (entityIds.length === 0 && !includeEntireScene) {
    return undefined
  }

  const response = await queryModelingCommand(engineCommandManager, {
    type: 'bounding_box',
    entity_ids: entityIds,
    output_unit: outputUnit,
  })
  return response?.type === 'bounding_box' ? response.data : undefined
}

export async function withDefaultGdtFrameDefaults<T extends GdtCommandData>({
  data,
  engineCommandManager,
  ast,
  sourceCode,
  outputUnit = DEFAULT_DEFAULT_LENGTH_UNIT,
  wasmInstance,
  distance = false,
  artifactGraph,
}: {
  data: T
  engineCommandManager: ConnectionManager
  distance?: boolean
  artifactGraph?: ArtifactGraph
  ast?: Node<Program>
  sourceCode?: string
  outputUnit?: UnitLength
  wasmInstance: ModuleType
}): Promise<T> {
  const selections = getSelectionsFromGdtData(data)
  const entityIds = getEngineEntityIdsForGdtSelections(selections)
  const existingFontSize = data.fontSize
    ? undefined
    : getExistingGdtFontSize(ast, sourceCode)
  let nextData =
    existingFontSize === undefined
      ? data
      : {
          ...data,
          fontSize: existingFontSize,
        }
  if (distance)
    return withDistanceFrameDefaults(
      nextData,
      engineCommandManager,
      artifactGraph,
      outputUnit,
      wasmInstance
    )
  let hasResolvedFramePlane = Boolean(nextData.framePlane)
  let framePositionSigns: GdtFramePositionSigns | undefined
  const shouldQueryNormalDefaults =
    !nextData.framePlane || !nextData.framePosition

  if (shouldQueryNormalDefaults) {
    const defaultsFromNormal =
      await getDefaultGdtFrameDefaultsFromSelectionNormals({
        engineCommandManager,
        selections,
      })

    if (defaultsFromNormal) {
      framePositionSigns = defaultsFromNormal.framePositionSigns
      hasResolvedFramePlane = true
      if (
        !nextData.framePlane &&
        defaultsFromNormal.framePlane !== KCL_PLANE_XY
      ) {
        nextData = {
          ...nextData,
          framePlane: defaultsFromNormal.framePlane,
        }
      }
    }
  }

  if (nextData.framePosition && hasResolvedFramePlane && nextData.fontSize) {
    return nextData
  }

  const needsSelectionBoundingBox =
    !hasResolvedFramePlane || !nextData.framePosition
  const selectionBoundingBox = needsSelectionBoundingBox
    ? await getBoundingBoxForGdtEntities({
        engineCommandManager,
        entityIds,
        outputUnit,
      })
    : undefined

  if (!hasResolvedFramePlane && selectionBoundingBox) {
    const framePlaneFromBoundingBox = getDefaultGdtFramePlaneFromBoundingBox(
      selectionBoundingBox.dimensions
    )

    if (framePlaneFromBoundingBox) {
      hasResolvedFramePlane = true
      if (framePlaneFromBoundingBox !== KCL_PLANE_XY) {
        nextData = {
          ...nextData,
          framePlane: framePlaneFromBoundingBox,
        }
      }
    }
  }

  const averageDimension =
    !nextData.framePosition && selectionBoundingBox
      ? getAverageBoundingBoxDimension(selectionBoundingBox.dimensions)
      : undefined

  if (!nextData.framePosition && averageDimension !== undefined) {
    const [xSign, ySign] = framePositionSigns ?? [1, 1]

    nextData = {
      ...nextData,
      framePosition: createFramePositionCommandValue(
        averageDimension * xSign,
        averageDimension * ySign,
        wasmInstance
      ),
    }
  }

  if (!nextData.fontSize) {
    const modelBoundingBox = await getBoundingBoxForGdtEntities({
      engineCommandManager,
      entityIds: [],
      outputUnit,
      includeEntireScene: true,
    })
    const modelAverageDimension = modelBoundingBox
      ? getAverageBoundingBoxDimension(modelBoundingBox.dimensions)
      : undefined

    if (modelAverageDimension === undefined) {
      return nextData
    }

    nextData = {
      ...nextData,
      fontSize: createFontSizeCommandValue(
        modelAverageDimension,
        outputUnit,
        wasmInstance
      ),
    }
  }

  return nextData
}

function getDistanceFramePlaneFromDirection(
  direction: Point3d
): GdtFramePlane | undefined {
  const values = [direction.x, direction.y, direction.z]
  if (!values.every(Number.isFinite) || Math.hypot(...values) === 0) {
    return undefined
  }
  // Choose the standard plane that retains the most of the measurement.
  // Prefer XY for horizontal distances, then XZ when the distance is vertical.
  const normalAxis = (['z', 'y', 'x'] as const).reduce((best, axis) =>
    Math.abs(direction[axis]) < Math.abs(direction[best]) ? axis : best
  )
  return getFeaturePlaneForNormalAxis(normalAxis)
}

function planeContainsDirection(
  plane: GdtFramePlane,
  direction: Point3d
): boolean {
  const normal =
    plane === KCL_PLANE_XY
      ? direction.z
      : plane === KCL_PLANE_XZ
        ? direction.y
        : direction.x
  return (
    Math.hypot(direction.x, direction.y, direction.z) > 0 &&
    Math.abs(normal) <=
      Math.hypot(direction.x, direction.y, direction.z) *
        AXIS_INFERENCE_TOLERANCE
  )
}

function createDistanceFramePositionCommandValue(
  setback: number | undefined,
  outputUnit: UnitLength,
  wasmInstance: ModuleType
): KclCommandValue {
  // Add a little extra clearance in either setback direction.
  const offset = createLiteral(
    roundOff((setback ?? 20) * 1.1, 4),
    wasmInstance,
    setback === undefined ? 'Mm' : baseUnitToNumericSuffix(outputUnit),
    4
  )
  const zero = createLiteral(
    0,
    wasmInstance,
    baseUnitToNumericSuffix(outputUnit),
    4
  )
  const valueText = `[${zero.raw}, ${offset.raw}]`
  return {
    valueAst: createArrayExpression([zero, offset]),
    valueText,
    valueCalculated: valueText,
  }
}

function distanceSetback(bounds: BoundingBox | undefined): number | undefined {
  if (!bounds) return undefined
  return getAverageBoundingBoxDimension(bounds.dimensions)
}

/** All points and bounds must use the same length unit. */
export function getOutsideDistanceSetback(
  from: Point3d,
  to: Point3d,
  plane: string,
  bounds: BoundingBox,
  minimumMargin = 0
): number | undefined {
  const axes: [Axis, Axis] | undefined =
    plane === KCL_PLANE_XY
      ? ['x', 'y']
      : plane === KCL_PLANE_XZ
        ? ['x', 'z']
        : plane === KCL_PLANE_YZ
          ? ['y', 'z']
          : undefined
  if (!axes || !bounds.center) return undefined
  const [x, y] = axes
  const dx = to[x] - from[x],
    dy = to[y] - from[y]
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length === 0) return undefined
  // Match the engine's plane-local perpendicular, oriented toward local +Y.
  const flip = dx < 0 ? -1 : 1
  const px = (-dy / length) * flip,
    py = (dx / length) * flip
  const project = (point: Point3d) =>
    px * (point[x] - bounds.center[x]) + py * (point[y] - bounds.center[y])
  const a = project(from),
    b = project(to)
  const extent =
    (Math.abs(px) * bounds.dimensions[x] +
      Math.abs(py) * bounds.dimensions[y]) /
    2
  const margin = distanceSetback(bounds)
  if (
    ![a, b, extent].every(Number.isFinite) ||
    extent < 0 ||
    margin === undefined
  )
    return undefined
  const sign = a + b < 0 ? -1 : 1
  const clearance =
    Math.max(0, extent - Math.min(sign * a, sign * b)) +
    Math.max(
      margin * GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO,
      minimumMargin
    )
  // The engine renders the dimension line at 0.8 * offset.y. Leaders use 1.0.
  return (sign * Math.ceil((clearance / 0.8) * 10000)) / 10000
}

function getGdtFontHeight(
  fontSize: KclCommandValue | undefined,
  outputUnit: UnitLength
): number | undefined {
  const value = fontSize?.valueAst
  if (
    value?.type !== 'Literal' ||
    typeof value.value !== 'object' ||
    value.value === null ||
    typeof value.value.value !== 'number'
  )
    return undefined
  const units: Partial<Record<typeof value.value.suffix, UnitLength>> = {
    Mm: 'mm',
    Cm: 'cm',
    M: 'm',
    Inch: 'in',
    Ft: 'ft',
    Yd: 'yd',
    None: outputUnit,
  }
  const unit = units[value.value.suffix]
  return unit && Number.isFinite(value.value.value) && value.value.value > 0
    ? (value.value.value * baseUnitToMm(unit)) / baseUnitToMm(outputUnit)
    : undefined
}

// Plane aliases and offsets have already been evaluated in the artifact graph.
function distanceSourcePlane(
  selections: Selections | undefined,
  graph: ArtifactGraph | undefined
): GdtFramePlane | undefined {
  if (!selections || !graph) return undefined
  const artifacts = selections.graphSelections.flatMap((selection) => {
    if (selection.entityRef?.type === 'edge')
      return selection.entityRef.side_faces.map((id) => graph.get(id))
    return [
      selection.artifact ??
        (selection.entityRef?.type === 'face'
          ? graph.get(selection.entityRef.face_id)
          : undefined),
    ]
  })
  const parents = selections.graphSelections.map((s) =>
    graph.get(s.engineTopologyFallback?.parentId ?? '')
  )
  const sketches = [...artifacts, ...parents]
    .map((a) => getSketchBlockForArtifact(a, graph, true))
    .filter((s) => s !== undefined)
  const planes = sketches.map((sketch) => {
    if (sketch.standardPlane)
      return defaultPlaneNameToKcl(sketch.standardPlane).replace('-', '')
    const axis =
      sketch.planeInfo && getDominantNormalAxis(sketch.planeInfo.zAxis)
    return axis ? getFeaturePlaneForNormalAxis(axis) : undefined
  })
  const plane = planes[0]
  if (plane !== 'XY' && plane !== 'XZ' && plane !== 'YZ') return undefined
  if (planes.some((p) => p !== plane)) return undefined
  const caps = artifacts.filter((a) => a?.type === 'cap')
  const single = selections.graphSelections.length === 1
  if (
    (single &&
      !caps.length &&
      !artifacts.some(
        (a) =>
          a?.type === 'segment' ||
          (a?.type === 'sweepEdge' && a.subType === 'opposite')
      )) ||
    (caps.length >= 2 && caps.some((a) => a?.id !== caps[0]?.id))
  )
    return getFramePlaneForFeaturePlane(plane)
  return plane
}

/** A closed circle's bounds may contain only its seam vertex. */
async function distanceCircleCenter(
  engine: ConnectionManager,
  id: string,
  scale: number
): Promise<Point3d | undefined> {
  const type = await queryModelingCommand(engine, {
    type: 'curve_get_type',
    curve_id: id,
  })
  if (
    type?.type !== 'curve_get_type' ||
    !['arc', 'nurbs'].includes(type.data.curve_type)
  )
    return undefined
  const response = await queryModelingCommand(engine, {
    type: 'curve_get_control_points',
    curve_id: id,
  })
  if (response?.type !== 'curve_get_control_points') return undefined
  const points = response.data.control_points.map((p) => ({
    x: p.x / scale,
    y: p.y / scale,
    z: p.z / scale,
  }))
  if (
    points.length < 4 ||
    points.some((p) => AXES.some((axis) => !Number.isFinite(p[axis])))
  )
    return undefined
  const midpoint = (axis: Axis) =>
    (Math.min(...points.map((p) => p[axis])) +
      Math.max(...points.map((p) => p[axis]))) /
    2
  const center = { x: midpoint('x'), y: midpoint('y'), z: midpoint('z') }
  if (type.data.curve_type === 'nurbs') {
    if (points.length !== 9) return undefined
    const radii = [0, 2, 4, 6].map((i) => ({
      x: points[i].x - center.x,
      y: points[i].y - center.y,
      z: points[i].z - center.z,
    }))
    const radius = Math.hypot(radii[0].x, radii[0].y, radii[0].z)
    if (!radius) return undefined
    const tolerance = radius * 1e-6
    for (let i = 0; i < 4; i++) {
      const a = radii[i],
        b = radii[(i + 1) % 4]
      if (
        Math.abs(Math.hypot(a.x, a.y, a.z) - radius) > tolerance ||
        Math.abs(a.x * b.x + a.y * b.y + a.z * b.z) > radius * tolerance ||
        AXES.some(
          (axis) =>
            Math.abs(
              points[2 * i + 1][axis] - center[axis] - a[axis] - b[axis]
            ) > tolerance
        )
      )
        return undefined
    }
  }
  return center
}

async function withDistanceFrameDefaults<T extends GdtCommandData>(
  data: T,
  engine: ConnectionManager,
  graph: ArtifactGraph | undefined,
  outputUnit: UnitLength,
  wasmInstance: ModuleType
): Promise<T> {
  const selections = getSelectionsFromGdtData(data)
  const ids = getEngineEntityIdsForGdtSelections(selections)
  const scale = baseUnitToMm(outputUnit)
  const point = (p: Point3d): Point3d => ({
    x: p.x / scale,
    y: p.y / scale,
    z: p.z / scale,
  })
  const direction = (a: Point3d, b: Point3d): Point3d => ({
    x: b.x - a.x,
    y: b.y - a.y,
    z: b.z - a.z,
  })
  const boundingBox = (entityIds: string[]) =>
    getBoundingBoxForGdtEntities({
      engineCommandManager: engine,
      entityIds,
      outputUnit,
      includeEntireScene: true,
    })
  const modelBounds = !data.fontSize ? await boundingBox([]) : undefined
  const average = modelBounds && distanceSetback(modelBounds)
  const fontSize =
    data.fontSize ??
    (average !== undefined
      ? createFontSizeCommandValue(average, outputUnit, wasmInstance)
      : undefined)
  if (data.framePlane && data.framePosition) return { ...data, fontSize }
  const inputs = [
    ...(selections?.graphSelections ?? []).map((selection) => ({
      selection,
      primitive: undefined,
    })),
    ...(
      selections?.otherSelections.filter(isEnginePrimitiveSelection) ?? []
    ).map((primitive) => ({ selection: undefined, primitive })),
  ]
  const targets = await Promise.all(
    inputs.map(async ({ selection, primitive }) => {
      const id =
        primitive?.entityId ??
        (selection &&
          getEngineEntityIdsForGdtSelections({
            graphSelections: [selection],
            otherSelections: [],
          })[0])
      const isEdge =
        selection?.entityRef?.type === 'edge' ||
        selection?.artifact?.type === 'segment' ||
        selection?.artifact?.type === 'sweepEdge' ||
        primitive?.primitiveType === 'edge'
      const sides =
        selection?.entityRef?.type === 'edge'
          ? selection.entityRef.side_faces
          : selection?.artifact?.type === 'segment' ||
              selection?.artifact?.type === 'sweepEdge'
            ? (selection.artifact.commonSurfaceIds ?? [])
            : []
      const bounds = id ? await boundingBox([id]) : undefined
      const endpoints =
        isEdge && id
          ? await queryModelingCommand(engine, {
              type: 'curve_get_end_points',
              curve_id: id,
            })
          : undefined
      const start =
        endpoints?.type === 'curve_get_end_points'
          ? point(endpoints.data.start)
          : undefined
      const end =
        endpoints?.type === 'curve_get_end_points'
          ? point(endpoints.data.end)
          : undefined
      let center = bounds?.center
      if (
        isEdge &&
        id &&
        start &&
        end &&
        Math.hypot(...Object.values(direction(start, end))) <= 1e-6 / scale
      )
        center = (await distanceCircleCenter(engine, id, scale)) ?? center
      if (!isEdge && id) {
        const face = await queryModelingCommand(engine, {
          type: 'face_get_center',
          object_id: id,
        })
        if (
          face?.type === 'face_get_center' &&
          AXES.every((axis) => Number.isFinite(face.data.pos[axis]))
        )
          center = point(face.data.pos)
      }
      return {
        id,
        selection,
        primitive,
        isEdge,
        sides,
        bounds,
        start,
        end,
        center,
      }
    })
  )
  const faceQueries = new Map<string, Promise<FaceIsPlanar | undefined>>()
  const planarFace = (id: string) => {
    const existing = faceQueries.get(id)
    if (existing) return existing
    const query = queryModelingCommand(engine, {
      type: 'face_is_planar',
      object_id: id,
    }).then((r) => (r?.type === 'face_is_planar' ? r.data : undefined))
    faceQueries.set(id, query)
    return query
  }
  const featurePlane = (bounds: BoundingBox | undefined) => {
    if (!bounds) return undefined
    const axis = getDecisiveAxis(bounds.dimensions, (a, b) => a - b)
    return axis &&
      bounds.dimensions[axis] <=
        Math.max(...Object.values(bounds.dimensions)) * AXIS_INFERENCE_TOLERANCE
      ? getFeaturePlaneForNormalAxis(axis)
      : undefined
  }
  const firstPlane = featurePlane(targets[0]?.bounds)
  const preferred =
    distanceSourcePlane(selections, graph) ??
    (firstPlane === featurePlane(targets[1]?.bounds) ? firstPlane : undefined)
  const choosePlane = (d: Point3d) =>
    preferred && planeContainsDirection(preferred, d)
      ? preferred
      : getDistanceFramePlaneFromDirection(d)
  let plane = data.framePlane
  if (!plane && targets.length >= 2 && targets.every((t) => t.isEdge)) {
    for (const id of targets[0].sides.filter((id) =>
      targets.every((t) => t.sides.includes(id))
    )) {
      const face = await planarFace(id)
      const normal = face && getNormalFromPlanarFace(face)
      const axis = normal && getDominantNormalAxis(normal)
      if (axis) {
        plane = getFeaturePlaneForNormalAxis(axis)
        break
      }
    }
  }
  const [a, b] = targets
  if (!plane && a && targets.length === 1 && a.isEdge && a.start && a.end)
    plane = choosePlane(direction(a.start, a.end))
  if (!plane && a?.center && b?.center)
    plane = choosePlane(direction(a.center, b.center))
  if (!plane && a && targets.every((t) => t.isEdge)) {
    const faces = await Promise.all(
      targets.map(async (t) => {
        for (const id of t.sides) {
          const face = await planarFace(id)
          if (face?.origin && getNormalFromPlanarFace(face)) return face
        }
      })
    )
    if (faces[0]?.origin && faces[1]?.origin)
      plane = choosePlane(direction(faces[0].origin, faces[1].origin))
    if (targets.length === 1) {
      const normals = (await Promise.all(a.sides.map(planarFace))).flatMap(
        (face) => {
          const normal = face && getNormalFromPlanarFace(face)
          return normal ? [normal] : []
        }
      )
      for (let i = 0; !plane && i < normals.length; i++)
        for (let j = i + 1; !plane && j < normals.length; j++) {
          const u = normals[i],
            v = normals[j]
          plane = choosePlane({
            x: u.y * v.z - u.z * v.y,
            y: u.z * v.x - u.x * v.z,
            z: u.x * v.y - u.y * v.x,
          })
        }
    }
  }
  const selectedBounds =
    ids.length === 1
      ? a?.bounds
      : ids.length
        ? await boundingBox(ids)
        : undefined
  plane ??=
    preferred ??
    (selectedBounds &&
      getDistanceFramePlaneFromDirection(selectedBounds.dimensions)) ??
    KCL_PLANE_XY
  let framePosition = data.framePosition
  if (!framePosition) {
    const from = targets.length === 1 ? a?.start : a?.center
    const to = targets.length === 1 ? a?.end : b?.center
    let bounds = modelBounds
    if (from && to) {
      const parents = await Promise.all(
        targets.map(async (t) => {
          if (!t.id) return undefined
          const parent = await queryModelingCommand(engine, {
            type: 'entity_get_parent_id',
            entity_id: t.id,
          })
          if (parent?.type === 'entity_get_parent_id')
            return parent.data.entity_id
          const face =
            t.sides
              .map((id) => graph?.get(id))
              .find((f) => f?.type === 'cap' || f?.type === 'wall') ??
            t.selection?.artifact
          const artifactId =
            t.selection?.engineTopologyFallback?.parentId ??
            t.primitive?.parentEntityId ??
            (face?.type === 'cap' || face?.type === 'wall'
              ? face.sweepId
              : undefined)
          const body = graph?.get(artifactId ?? '')
          return body?.type === 'sweep'
            ? (body.pathId ?? undefined)
            : artifactId
        })
      )
      const bodyBounds =
        parents.length && parents.every((id) => id !== undefined)
          ? await boundingBox([...new Set(parents)])
          : undefined
      bounds = bodyBounds ?? modelBounds ?? (await boundingBox([]))
    }
    if (!bounds && distanceSetback(selectedBounds) === undefined)
      bounds = await boundingBox([])
    const margin =
      targets.length === 1
        ? 2 *
          Math.max(
            (distanceSetback(bounds) ?? 0) *
              GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO,
            getGdtFontHeight(fontSize, outputUnit) ?? 0
          )
        : 0
    const outside =
      from && to && bounds
        ? getOutsideDistanceSetback(from, to, plane, bounds, margin)
        : undefined
    framePosition = createDistanceFramePositionCommandValue(
      outside ?? distanceSetback(selectedBounds) ?? distanceSetback(bounds),
      outputUnit,
      wasmInstance
    )
  }
  return { ...data, framePlane: plane, framePosition, fontSize }
}
