import type { BoundingBox, FaceIsPlanar, Point3d } from '@kittycad/lib'

import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createArrayExpression, createLiteral } from '@src/lang/create'
import { toUtf16 } from '@src/lang/errors'
import { entityReferenceKey } from '@src/lang/queryAst'
import { engineIdForArtifact } from '@src/lang/std/kclNamedViews'
import type {
  ArtifactGraph,
  ArtifactId,
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
import { getEngineTopologyFallbackNormalized } from '@src/lib/primitiveBodySelection'
import { isArray, roundOff, uuidv4 } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EntityReference,
  Selections,
} from '@src/machines/modelingSharedTypes'
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

function hasOnlyGdtEdgeSelections(selections: Selections | undefined): boolean {
  if (
    !selections ||
    selections.graphSelections.length + selections.otherSelections.length === 0
  )
    return false
  return (
    selections.graphSelections.every(({ entityRef, artifact }) => {
      if (entityRef)
        return (
          entityRef.type === 'edge' ||
          entityRef.type === 'solid2d_edge' ||
          entityRef.type === 'segment'
        )
      return (
        artifact?.type === 'sweepEdge' ||
        artifact?.type === 'primitiveEdge' ||
        artifact?.type === 'edgeCutEdge' ||
        artifact?.type === 'segment'
      )
    }) &&
    selections.otherSelections.every(
      (selection) =>
        typeof selection === 'object' &&
        'type' in selection &&
        selection.type === 'enginePrimitive' &&
        selection.primitiveType === 'edge'
    )
  )
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

    const reference = selection.entityRef
    if (reference?.type === 'face') return [reference.face_id]
    if (reference?.type === 'segment') return [reference.segment_id]
    if (reference?.type === 'solid2d_edge') return [reference.edge_id]
    if (reference?.type === 'edge') return []

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

  return deduplicateArtifactIds([
    ...entityIds,
    ...selections.otherSelections.flatMap((selection) =>
      typeof selection === 'object' &&
      'type' in selection &&
      selection.type === 'enginePrimitive' &&
      (selection.primitiveType === 'face' || selection.primitiveType === 'edge')
        ? [selection.entityId]
        : []
    ),
  ])
}

export function getPlanarFaceEntityIdsForGdtSelections(
  selections: Selections | undefined
): ArtifactId[] {
  if (!selections) {
    return []
  }

  const entityIds = selections.graphSelections.flatMap((selection) => {
    if (selection.entityRef?.type === 'face') {
      return [selection.engineEntityId ?? selection.entityRef.face_id]
    }
    if (selection.entityRef?.type === 'edge') return []
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

  return deduplicateArtifactIds([
    ...entityIds,
    ...selections.otherSelections.flatMap((selection) =>
      typeof selection === 'object' &&
      'type' in selection &&
      selection.type === 'enginePrimitive' &&
      selection.primitiveType === 'face'
        ? [selection.entityId]
        : []
    ),
  ])
}

async function getGdtEdgeIdFromFaces(
  reference: Extract<EntityReference, { type: 'edge' }>,
  engineCommandManager: Pick<ConnectionManager, 'sendSceneCommand'>,
  artifactGraph: ArtifactGraph | undefined
): Promise<ArtifactId | undefined> {
  const faceId = (id: string) => {
    const artifact = artifactGraph?.get(id)
    return artifact?.type === 'segment' ? (artifact.surfaceId ?? id) : id
  }
  const sideFaces = reference.side_faces.map(faceId)
  if (sideFaces.length !== 2) return undefined
  const parent = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: { type: 'entity_get_parent_id', entity_id: sideFaces[0] },
  })
  if (!isModelingResponse(parent)) return undefined
  const parentResult = parent.resp.data.modeling_response
  if (parentResult.type !== 'entity_get_parent_id') return undefined
  const common = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'solid3d_get_common_edge',
      object_id: parentResult.data.entity_id,
      face_ids: sideFaces,
    },
  })
  if (!isModelingResponse(common)) return undefined
  const commonResult = common.resp.data.modeling_response
  if (
    commonResult.type !== 'solid3d_get_common_edge' ||
    !commonResult.data.edge
  )
    return undefined
  const edgeId = commonResult.data.edge
  const resolved = await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: { type: 'query_entity_type', entity_id: edgeId },
  })
  if (!isModelingResponse(resolved)) return undefined
  const resolvedResult = resolved.resp.data.modeling_response
  if (resolvedResult.type !== 'query_entity_type') return undefined
  return entityReferenceKey(resolvedResult.data.reference) ===
    entityReferenceKey({
      ...reference,
      side_faces: sideFaces,
      end_faces: reference.end_faces?.map(faceId),
    })
    ? edgeId
    : undefined
}

async function getBoundingBoxEntityIdsForGdtSelections(
  selections: Selections | undefined,
  engineCommandManager: Pick<ConnectionManager, 'sendSceneCommand'>,
  artifactGraph: ArtifactGraph | undefined
): Promise<ArtifactId[]> {
  const entityIds = getEngineEntityIdsForGdtSelections(selections)
  for (const selection of selections?.graphSelections ?? []) {
    const reference = selection.entityRef
    if (reference?.type !== 'edge' || selection.engineEntityId) {
      continue
    }
    const fallback = reference.topology_fallback
    const topology =
      getEngineTopologyFallbackNormalized(selection) ??
      (fallback
        ? {
            parentId: fallback.parent_id,
            primitiveIndex: fallback.primitive_index,
          }
        : undefined)
    try {
      if (!topology) {
        const edgeId = await getGdtEdgeIdFromFaces(
          reference,
          engineCommandManager,
          artifactGraph
        )
        if (!edgeId) return []
        entityIds.push(edgeId)
        continue
      }
      if (
        !Number.isInteger(topology.primitiveIndex) ||
        topology.primitiveIndex < 0 ||
        topology.primitiveIndex > 0xffffffff
      )
        return []
      const parentArtifact = artifactGraph?.get(topology.parentId)
      const objectId =
        artifactGraph &&
        (parentArtifact?.type === 'sweep' ||
          parentArtifact?.type === 'compositeSolid')
          ? engineIdForArtifact({
              id: topology.parentId,
              artifact: parentArtifact,
              artifactGraph,
            })
          : topology.parentId
      const response = await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'solid3d_get_edge_uuid',
          object_id: objectId,
          edge_index: topology.primitiveIndex,
        },
      })
      if (!isModelingResponse(response)) return []
      const result = response.resp.data.modeling_response
      if (result.type === 'solid3d_get_edge_uuid') {
        entityIds.push(result.data.edge_id)
      } else {
        return []
      }
    } catch {
      return []
    }
  }
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
  dimensions: BoundingBox['dimensions'],
  selectionKind: 'face' | 'edge' = 'face'
): GdtFramePlane | undefined {
  if (selectionKind === 'edge') {
    const values = AXES.map((axis) => dimensions[axis])
    if (values.some((value) => !Number.isFinite(value) || value < 0))
      return undefined
    const longest = Math.max(...values)
    if (longest === 0) return undefined
    const thinThreshold =
      Math.min(...values) + longest * AXIS_INFERENCE_TOLERANCE
    if (dimensions.z <= thinThreshold) return KCL_PLANE_XY
    if (dimensions.y <= thinThreshold) return KCL_PLANE_XZ
    return KCL_PLANE_YZ
  }
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
  engineCommandManager: Pick<ConnectionManager, 'sendSceneCommand'>,
  entityId: ArtifactId
): Promise<Point3d | undefined> {
  try {
    const response = await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'face_is_planar',
        object_id: entityId,
      },
    })

    if (!isModelingResponse(response)) {
      return undefined
    }

    const modelingResponse = response.resp.data.modeling_response
    if (modelingResponse.type !== 'face_is_planar') {
      return undefined
    }

    return getNormalFromPlanarFace(modelingResponse.data)
  } catch {
    return undefined
  }
}

async function getDefaultGdtFrameDefaultsFromSelectionNormals({
  engineCommandManager,
  selections,
}: {
  engineCommandManager: Pick<ConnectionManager, 'sendSceneCommand'>
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
  engineCommandManager: Pick<ConnectionManager, 'sendSceneCommand'>
  entityIds: ArtifactId[]
  outputUnit: UnitLength
  includeEntireScene?: boolean
}): Promise<BoundingBox | undefined> {
  if (entityIds.length === 0 && !includeEntireScene) {
    return undefined
  }

  try {
    const response = await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'bounding_box',
        entity_ids: entityIds,
        output_unit: outputUnit,
      },
    })

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

export async function withDefaultGdtFrameDefaults<T extends GdtCommandData>({
  data,
  engineCommandManager,
  ast,
  artifactGraph,
  sourceCode,
  outputUnit = DEFAULT_DEFAULT_LENGTH_UNIT,
  isDistance = false,
  wasmInstance,
}: {
  data: T
  engineCommandManager: Pick<ConnectionManager, 'sendSceneCommand'>
  ast?: Node<Program>
  artifactGraph?: ArtifactGraph
  sourceCode?: string
  outputUnit?: UnitLength
  isDistance?: boolean
  wasmInstance: ModuleType
}): Promise<T> {
  const selections = getSelectionsFromGdtData(data)
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
        entityIds: await getBoundingBoxEntityIdsForGdtSelections(
          selections,
          engineCommandManager,
          artifactGraph
        ),
        outputUnit,
      })
    : undefined

  if (!hasResolvedFramePlane && selectionBoundingBox) {
    const framePlaneFromBoundingBox = getDefaultGdtFramePlaneFromBoundingBox(
      selectionBoundingBox.dimensions,
      hasOnlyGdtEdgeSelections(selections) ? 'edge' : 'face'
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
        isDistance ? 0 : averageDimension * xSign,
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
