import { unwrapSceneCommandResponse } from '@src/lib/engineConnection/utils'
import type { BoundingBox, FaceIsPlanar, Point3d } from '@kittycad/lib'

import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createArrayExpression, createLiteral } from '@src/lang/create'
import { toUtf16 } from '@src/lang/errors'
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
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { getDistanceFramePlaneFromKcl } from '@src/lib/gdtDistanceKclPlane'
import { baseUnitToMm, isArray, roundOff, uuidv4 } from '@src/lib/utils'
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

    if (selection.entityRef?.type === 'edge') {
      return [
        ...selection.entityRef.side_faces,
        ...(selection.entityRef.end_faces ?? []),
      ]
    }

    if (artifact?.type === 'sweepEdge' || artifact?.type === 'segment') {
      return artifact.commonSurfaceIds ?? []
    }

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

  const primitiveFaceIds = selections.otherSelections.flatMap((selection) =>
    typeof selection === 'object' &&
    'type' in selection &&
    selection.type === 'enginePrimitive' &&
    selection.primitiveType === 'face'
      ? [selection.entityId]
      : []
  )
  return deduplicateArtifactIds([...entityIds, ...primitiveFaceIds])
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

function getFlatFeaturePlane(
  dimensions: BoundingBox['dimensions']
): GdtFramePlane | undefined {
  const axis = getDecisiveAxis(dimensions, (left, right) => left - right)
  if (!axis) return undefined
  const scale = Math.max(dimensions.x, dimensions.y, dimensions.z)
  return scale > 0 && dimensions[axis] <= scale * AXIS_INFERENCE_TOLERANCE
    ? getFeaturePlaneForNormalAxis(axis)
    : undefined
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

async function getPlanarFace(
  engineCommandManager: ConnectionManager,
  entityId: ArtifactId
): Promise<FaceIsPlanar | undefined> {
  try {
    const response = unwrapSceneCommandResponse(
      await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'face_is_planar',
          object_id: entityId,
        },
      })
    )

    if (!isModelingResponse(response)) {
      return undefined
    }

    const modelingResponse = response.resp.data.modeling_response
    if (modelingResponse.type !== 'face_is_planar') {
      return undefined
    }

    return modelingResponse.data
  } catch {
    return undefined
  }
}

async function getPlanarFaceNormal(
  engine: ConnectionManager,
  id: ArtifactId
): Promise<Point3d | undefined> {
  const face = await getPlanarFace(engine, id)
  return face && getNormalFromPlanarFace(face)
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

  try {
    const response = unwrapSceneCommandResponse(
      await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'bounding_box',
          entity_ids: entityIds,
          output_unit: outputUnit,
        },
      })
    )

    if (!isModelingResponse(response)) {
      return undefined
    }

    const modelingResponse = response.resp.data.modeling_response
    if (modelingResponse.type !== 'bounding_box') {
      return undefined
    }

    return modelingResponse.data
  } catch {
    return undefined
  }
}

async function getDistanceGeometryPlane(
  engine: ConnectionManager,
  selections: Selections | undefined,
  preferredPlane: GdtFramePlane | undefined
): Promise<GdtFramePlane | undefined> {
  const edges =
    selections?.graphSelections.filter(
      (selection) =>
        selection.entityRef?.type === 'edge' ||
        selection.artifact?.type === 'segment' ||
        selection.artifact?.type === 'sweepEdge'
    ) ?? []
  const isSingleEdge =
    edges.length === 1 &&
    (selections?.graphSelections.length ?? 0) +
      (selections?.otherSelections.length ?? 0) ===
      1
  if (isSingleEdge) {
    const id = edges[0].engineEntityId ?? edges[0].artifact?.id
    if (id) {
      try {
        const response = unwrapSceneCommandResponse(
          await engine.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'curve_get_end_points', curve_id: id },
          })
        )
        if (
          isModelingResponse(response) &&
          response.resp.data.modeling_response.type === 'curve_get_end_points'
        ) {
          const { start, end } = response.resp.data.modeling_response.data
          const direction = {
            x: end.x - start.x,
            y: end.y - start.y,
            z: end.z - start.z,
          }
          const plane = getDistanceFramePlaneFromDirection(direction)
          if (plane)
            return preferredPlane &&
              planeContainsDirection(preferredPlane, direction)
              ? preferredPlane
              : plane
        }
      } catch {
        /* Older engines may not expose curve endpoints for every edge. */
      }
    }
  }
  const sideFaces = edges.map((selection) =>
    selection.entityRef?.type === 'edge'
      ? selection.entityRef.side_faces
      : selection.artifact?.type === 'segment' ||
          selection.artifact?.type === 'sweepEdge'
        ? (selection.artifact.commonSurfaceIds ?? [])
        : []
  )
  const commonFaces =
    edges.length >= 2
      ? sideFaces[0].filter((id) => sideFaces.every((ids) => ids.includes(id)))
      : []
  for (const id of commonFaces) {
    const normal = await getPlanarFaceNormal(engine, id)
    const axis = normal && getDominantNormalAxis(normal)
    if (axis) return getFeaturePlaneForNormalAxis(axis)
  }
  // The intersection of two planar side faces gives a straight edge's axis.
  // Do not use the end faces: they only disambiguate which edge was picked.
  if (edges.length >= 2) {
    const planar = await Promise.all(
      sideFaces.map(async (ids) => {
        for (const id of ids.filter((id) => !commonFaces.includes(id))) {
          const face = await getPlanarFace(engine, id)
          if (face?.origin && getNormalFromPlanarFace(face)) return face
        }
        return undefined
      })
    )
    const [a, b] = planar
    if (a?.origin && b?.origin) {
      const direction = {
        x: b.origin.x - a.origin.x,
        y: b.origin.y - a.origin.y,
        z: b.origin.z - a.origin.z,
      }
      const axis = a.z_axis && getDominantNormalAxis(a.z_axis)
      const plane = axis && getFeaturePlaneForNormalAxis(axis)
      return plane && planeContainsDirection(plane, direction)
        ? plane
        : getDistanceFramePlaneFromDirection(direction)
    }
  }
  if (isSingleEdge) {
    const normals: Point3d[] = []
    for (const id of sideFaces[0]) {
      const normal = await getPlanarFaceNormal(engine, id)
      if (normal) normals.push(normal)
    }
    for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        const a = normals[i],
          b = normals[j]
        const direction = {
          x: a.y * b.z - a.z * b.y,
          y: a.z * b.x - a.x * b.z,
          z: a.x * b.y - a.y * b.x,
        }
        const plane = getDistanceFramePlaneFromDirection(direction)
        if (plane)
          return preferredPlane &&
            planeContainsDirection(preferredPlane, direction)
            ? preferredPlane
            : plane
      }
    }
  }
  return undefined
}

export async function getCircularEdgeCenter(
  engine: Pick<ConnectionManager, 'sendSceneCommand'>,
  id: ArtifactId,
  outputUnit: UnitLength
): Promise<Point3d | undefined> {
  try {
    const type = unwrapSceneCommandResponse(
      await engine.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'curve_get_type', curve_id: id },
      })
    )
    if (
      !isModelingResponse(type) ||
      type.resp.data.modeling_response.type !== 'curve_get_type' ||
      !['arc', 'nurbs'].includes(
        type.resp.data.modeling_response.data.curve_type
      )
    )
      return undefined
    const endpoints = unwrapSceneCommandResponse(
      await engine.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'curve_get_end_points', curve_id: id },
      })
    )
    if (
      !isModelingResponse(endpoints) ||
      endpoints.resp.data.modeling_response.type !== 'curve_get_end_points'
    )
      return undefined
    const { start, end } = endpoints.resp.data.modeling_response.data
    if (Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z) > 1e-6)
      return undefined
    const response = unwrapSceneCommandResponse(
      await engine.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'curve_get_control_points', curve_id: id },
      })
    )
    if (
      !isModelingResponse(response) ||
      response.resp.data.modeling_response.type !== 'curve_get_control_points'
    )
      return undefined
    const points = response.resp.data.modeling_response.data.control_points
    if (
      points.length < 4 ||
      points.some((p) => AXES.some((a) => !Number.isFinite(p[a])))
    )
      return undefined
    // A full circle's control polygon is symmetric about its center. Unlike
    // its seam vertices, it spans both sides of the circle in world space.
    const scale = baseUnitToMm(outputUnit)
    const center = (axis: Axis) =>
      (Math.min(...points.map((p) => p[axis])) +
        Math.max(...points.map((p) => p[axis]))) /
      (2 * scale)
    const result = { x: center('x'), y: center('y'), z: center('z') }
    if (type.resp.data.modeling_response.data.curve_type === 'nurbs') {
      // The engine may expose a circle as its quadratic NURBS form. Check
      // the four equal, orthogonal radii and tangent corners before using
      // this center; a closed spline or ellipse must retain its fallback.
      if (points.length !== 9) return undefined
      const radii = [0, 2, 4, 6].map((i) => ({
        x: points[i].x / scale - result.x,
        y: points[i].y / scale - result.y,
        z: points[i].z / scale - result.z,
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
                points[2 * i + 1][axis] / scale -
                  result[axis] -
                  a[axis] -
                  b[axis]
              ) > tolerance
          )
        )
          return undefined
      }
    }
    return result
  } catch {
    return undefined
  }
}

async function getDistanceFaceCenter(
  engine: ConnectionManager,
  id: ArtifactId,
  outputUnit: UnitLength
): Promise<Point3d | undefined> {
  try {
    const response = unwrapSceneCommandResponse(
      await engine.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'face_get_center', object_id: id },
      })
    )
    if (
      !isModelingResponse(response) ||
      response.resp.data.modeling_response.type !== 'face_get_center'
    )
      return undefined
    const { pos } = response.resp.data.modeling_response.data
    if (AXES.some((axis) => !Number.isFinite(pos[axis]))) return undefined
    const scale = baseUnitToMm(outputUnit)
    return { x: pos.x / scale, y: pos.y / scale, z: pos.z / scale }
  } catch {
    return undefined
  }
}

async function getDistanceFeatureCenters(
  engine: ConnectionManager,
  selections: Selections | undefined,
  entityIds: ArtifactId[],
  bounds: Array<BoundingBox | undefined>,
  outputUnit: UnitLength
): Promise<Array<Point3d | undefined>> {
  return Promise.all(
    entityIds.map(async (id, index) => {
      // Closed circular edges have coincident seam vertices, so their
      // bounding box center is on the rim, not the annotation's center.
      const selection = selections?.graphSelections.find(
        (s) =>
          (s.engineEntityId ??
            (s.entityRef?.type === 'face'
              ? s.entityRef.face_id
              : s.artifact?.id)) === id
      )
      const isEdge =
        selection?.entityRef?.type === 'edge' ||
        selection?.artifact?.type === 'segment' ||
        selection?.artifact?.type === 'sweepEdge' ||
        selections?.otherSelections.some(
          (s) =>
            typeof s === 'object' &&
            'entityId' in s &&
            s.entityId === id &&
            s.primitiveType === 'edge'
        )
      if (isEdge) {
        const center = await getCircularEdgeCenter(engine, id, outputUnit)
        if (center) return center
      } else {
        // Cylindrical face bounds can differ from the actual hole center.
        // Use the center of its boundary loops, in the file's units, just
        // as circular rims use their circle center for outward placement.
        const center = await getDistanceFaceCenter(engine, id, outputUnit)
        if (center) return center
      }
      return bounds[index]?.center
    })
  )
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

async function getOutsideSetbackForSelections({
  engine,
  selections,
  artifactGraph,
  entityIds,
  endpointBounds,
  endpointCenters,
  modelBounds,
  plane,
  outputUnit,
  fontSize,
}: {
  engine: ConnectionManager
  selections: Selections | undefined
  artifactGraph: ArtifactGraph | undefined
  entityIds: ArtifactId[]
  endpointBounds: Array<BoundingBox | undefined> | undefined
  endpointCenters: Array<Point3d | undefined> | undefined
  modelBounds: BoundingBox | undefined
  plane: string | KclCommandValue | undefined
  outputUnit: UnitLength
  fontSize: KclCommandValue | undefined
}): Promise<number | undefined> {
  const planeName = typeof plane === 'string' ? plane : plane?.valueText
  if (
    !planeName ||
    ![KCL_PLANE_XY, KCL_PLANE_XZ, KCL_PLANE_YZ].includes(planeName)
  )
    return undefined
  let from: Point3d | undefined, to: Point3d | undefined
  if (entityIds.length === 2) {
    const bounds =
      endpointBounds ??
      (await Promise.all(
        entityIds.map((id) =>
          getBoundingBoxForGdtEntities({
            engineCommandManager: engine,
            entityIds: [id],
            outputUnit,
          })
        )
      ))
    const centers =
      endpointCenters ??
      (await getDistanceFeatureCenters(
        engine,
        selections,
        entityIds,
        bounds,
        outputUnit
      ))
    from = centers[0]
    to = centers[1]
  } else if (entityIds.length === 1) {
    const isEdge =
      selections?.graphSelections.some(
        (selection) =>
          selection.entityRef?.type === 'edge' ||
          selection.artifact?.type === 'segment' ||
          selection.artifact?.type === 'sweepEdge'
      ) ||
      selections?.otherSelections.some(
        (selection) =>
          typeof selection === 'object' &&
          'primitiveType' in selection &&
          selection.primitiveType === 'edge'
      )
    if (!isEdge) return undefined
    try {
      const response = unwrapSceneCommandResponse(
        await engine.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'curve_get_end_points', curve_id: entityIds[0] },
        })
      )
      if (
        isModelingResponse(response) &&
        response.resp.data.modeling_response.type === 'curve_get_end_points'
      ) {
        const { start, end } = response.resp.data.modeling_response.data
        const scale = baseUnitToMm(outputUnit)
        from = { x: start.x / scale, y: start.y / scale, z: start.z / scale }
        to = { x: end.x / scale, y: end.y / scale, z: end.z / scale }
      }
    } catch {
      /* Retain the existing bounds-based fallback when endpoints are unavailable. */
    }
  }
  if (!from || !to) return undefined

  const parents: ArtifactId[] = []
  for (const id of entityIds) {
    const selection = selections?.graphSelections.find(
      (s) => (s.engineEntityId ?? s.artifact?.id) === id
    )
    const primitive = selections?.otherSelections.find(
      (s) => typeof s === 'object' && 'entityId' in s && s.entityId === id
    )
    const faces =
      selection?.entityRef?.type === 'edge'
        ? selection.entityRef.side_faces.map((faceId) =>
            artifactGraph?.get(faceId)
          )
        : [selection?.artifact]
    const face = faces.find((a) => a?.type === 'cap' || a?.type === 'wall')
    let parent =
      selection?.engineTopologyFallback?.parentId ??
      (typeof primitive === 'object' && 'parentEntityId' in primitive
        ? primitive.parentEntityId
        : undefined) ??
      (face?.type === 'cap' || face?.type === 'wall' ? face.sweepId : undefined)
    if (!parent) {
      try {
        const response = unwrapSceneCommandResponse(
          await engine.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'entity_get_parent_id', entity_id: id },
          })
        )
        if (
          isModelingResponse(response) &&
          response.resp.data.modeling_response.type === 'entity_get_parent_id'
        )
          parent = response.resp.data.modeling_response.data.entity_id
      } catch {
        /* The scene bounds remain a fallback for unresolved bodies. */
      }
    }
    if (parent) parents.push(parent)
  }
  const bodyBounds =
    parents.length === entityIds.length
      ? await getBoundingBoxForGdtEntities({
          engineCommandManager: engine,
          entityIds: deduplicateArtifactIds(parents),
          outputUnit,
        })
      : undefined
  const bounds =
    bodyBounds ??
    modelBounds ??
    (await getBoundingBoxForGdtEntities({
      engineCommandManager: engine,
      entityIds: [],
      outputUnit,
      includeEntireScene: true,
    }))
  if (!bounds) return undefined
  // A single-edge label is centered on its dimension line. Leave room for
  // its width as well as clearing the body, including an inherited font.
  const minimumMargin =
    entityIds.length === 1
      ? 2 *
        Math.max(
          (distanceSetback(bounds) ?? 0) *
            GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO,
          getGdtFontHeight(fontSize, outputUnit) ?? 0
        )
      : 0
  return getOutsideDistanceSetback(from, to, planeName, bounds, minimumMargin)
}

export async function withDefaultGdtFrameDefaults<T extends GdtCommandData>({
  data,
  engineCommandManager,
  ast,
  artifactGraph,
  sourceCode,
  outputUnit = DEFAULT_DEFAULT_LENGTH_UNIT,
  wasmInstance,
  distance = false,
}: {
  data: T
  engineCommandManager: ConnectionManager
  ast?: Node<Program>
  artifactGraph?: ArtifactGraph
  sourceCode?: string
  outputUnit?: UnitLength
  wasmInstance: ModuleType
  distance?: boolean
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
  let hasResolvedFramePlane = Boolean(nextData.framePlane)
  const kclFramePlane =
    distance && !nextData.framePlane
      ? getDistanceFramePlaneFromKcl(ast, artifactGraph, selections)
      : undefined
  if (distance && !nextData.framePlane) {
    const framePlane = await getDistanceGeometryPlane(
      engineCommandManager,
      selections,
      kclFramePlane
    )
    if (framePlane) {
      nextData = { ...nextData, framePlane }
      hasResolvedFramePlane = true
    }
  }
  let distanceBoundingBox: BoundingBox | undefined
  let distanceEndpointBounds: Array<BoundingBox | undefined> | undefined
  let distanceEndpointCenters: Array<Point3d | undefined> | undefined
  if (distance && !nextData.framePlane && entityIds.length === 1) {
    distanceBoundingBox = await getBoundingBoxForGdtEntities({
      engineCommandManager,
      entityIds,
      outputUnit,
    })
    const dimensions = distanceBoundingBox?.dimensions
    const isLine =
      dimensions &&
      [dimensions.x, dimensions.y, dimensions.z].filter((value) => value > 0)
        .length === 1
    const framePlane =
      !isLine && kclFramePlane
        ? kclFramePlane
        : dimensions && getDistanceFramePlaneFromDirection(dimensions)
    if (framePlane) {
      nextData = { ...nextData, framePlane }
      hasResolvedFramePlane = true
    }
  }
  if (distance && !nextData.framePlane && entityIds.length === 2) {
    const bounds = await Promise.all(
      entityIds.map((entityId) =>
        getBoundingBoxForGdtEntities({
          engineCommandManager,
          entityIds: [entityId],
          outputUnit,
        })
      )
    )
    distanceEndpointBounds = bounds
    distanceEndpointCenters = await getDistanceFeatureCenters(
      engineCommandManager,
      selections,
      entityIds,
      bounds,
      outputUnit
    )
    const [from, to] = distanceEndpointCenters
    if (from && to) {
      const direction = {
        x: to.x - from.x,
        y: to.y - from.y,
        z: to.z - from.z,
      }
      const fromPlane = bounds[0] && getFlatFeaturePlane(bounds[0].dimensions)
      const toPlane = bounds[1] && getFlatFeaturePlane(bounds[1].dimensions)
      // Circular rims retain their face plane when their centers are
      // separated along an axis shared by more than one standard plane.
      const featurePlane = fromPlane === toPlane ? fromPlane : undefined
      const preferredPlane = kclFramePlane ?? featurePlane
      const framePlane =
        preferredPlane && planeContainsDirection(preferredPlane, direction)
          ? preferredPlane
          : getDistanceFramePlaneFromDirection(direction)
      if (framePlane) {
        nextData = { ...nextData, framePlane }
        hasResolvedFramePlane = true
      }
    }
  }
  if (distance && !nextData.framePlane) {
    const framePlane = kclFramePlane
    if (framePlane) {
      nextData = { ...nextData, framePlane }
      hasResolvedFramePlane = true
    }
  }
  let framePositionSigns: GdtFramePositionSigns | undefined
  const shouldQueryNormalDefaults =
    !distance && (!nextData.framePlane || !nextData.framePosition)

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
        (distance || defaultsFromNormal.framePlane !== KCL_PLANE_XY)
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
    ? (distanceBoundingBox ??
      (await getBoundingBoxForGdtEntities({
        engineCommandManager,
        entityIds,
        outputUnit,
      })))
    : undefined

  if (!hasResolvedFramePlane && selectionBoundingBox) {
    const framePlaneFromBoundingBox = distance
      ? getDistanceFramePlaneFromDirection(selectionBoundingBox.dimensions)
      : getDefaultGdtFramePlaneFromBoundingBox(selectionBoundingBox.dimensions)

    if (framePlaneFromBoundingBox) {
      hasResolvedFramePlane = true
      if (distance || framePlaneFromBoundingBox !== KCL_PLANE_XY) {
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

  if (!distance && !nextData.framePosition && averageDimension !== undefined) {
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

  let setback = distanceSetback(selectionBoundingBox)
  let modelBoundingBox: BoundingBox | undefined
  if (
    !nextData.fontSize ||
    (distance && !nextData.framePosition && setback === undefined)
  ) {
    modelBoundingBox = await getBoundingBoxForGdtEntities({
      engineCommandManager,
      entityIds: [],
      outputUnit,
      includeEntireScene: true,
    })
    const modelAverageDimension = modelBoundingBox
      ? getAverageBoundingBoxDimension(modelBoundingBox.dimensions)
      : undefined

    setback ??= distanceSetback(modelBoundingBox)
    if (!nextData.fontSize && modelAverageDimension !== undefined) {
      nextData = {
        ...nextData,
        fontSize: createFontSizeCommandValue(
          modelAverageDimension,
          outputUnit,
          wasmInstance
        ),
      }
    }
  }

  if (distance && !nextData.framePosition) {
    setback =
      (await getOutsideSetbackForSelections({
        engine: engineCommandManager,
        selections,
        artifactGraph,
        entityIds,
        endpointBounds: distanceEndpointBounds,
        endpointCenters: distanceEndpointCenters,
        modelBounds: modelBoundingBox,
        plane: nextData.framePlane,
        outputUnit,
        fontSize: nextData.fontSize,
      })) ?? setback
    nextData = {
      ...nextData,
      framePosition: createDistanceFramePositionCommandValue(
        setback,
        outputUnit,
        wasmInstance
      ),
    }
  }

  if (distance && !nextData.framePlane) {
    nextData = { ...nextData, framePlane: KCL_PLANE_XY }
  }

  return nextData
}
