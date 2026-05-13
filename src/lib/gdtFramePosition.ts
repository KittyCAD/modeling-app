import type { BoundingBox, FaceIsPlanar, Point3d } from '@kittycad/lib'

import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { createArrayExpression, createLiteral } from '@src/lang/create'
import type { ArtifactId } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  KCL_PLANE_XY,
  KCL_PLANE_XZ,
  KCL_PLANE_YZ,
} from '@src/lib/constants'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { roundOff, uuidv4 } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'

type Axis = 'x' | 'y' | 'z'
type GdtFramePlane =
  | typeof KCL_PLANE_XY
  | typeof KCL_PLANE_XZ
  | typeof KCL_PLANE_YZ

const AXIS_INFERENCE_TOLERANCE = 0.05
const AXES: Axis[] = ['x', 'y', 'z']

type GdtCommandData =
  | ModelingCommandSchema['GDT Flatness']
  | ModelingCommandSchema['GDT Datum']
  | ModelingCommandSchema['GDT Position']
  | ModelingCommandSchema['GDT Profile']
  | ModelingCommandSchema['GDT Distance']
  | ModelingCommandSchema['GDT Perpendicularity']
  | ModelingCommandSchema['GDT Parallelism']
  | ModelingCommandSchema['GDT Annotation']

function getSelectionsFromGdtData(
  data: GdtCommandData
): Selections | undefined {
  if ('objects' in data) {
    return data.objects
  }
  if ('faces' in data) {
    return data.faces
  }
  if ('edges' in data) {
    return data.edges
  }
  return undefined
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

  return deduplicateArtifactIds(entityIds)
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

export function getDefaultGdtFramePlaneFromNormal(
  normal: Point3d
): GdtFramePlane | undefined {
  const axis = getDecisiveAxis(
    {
      x: Math.abs(normal.x),
      y: Math.abs(normal.y),
      z: Math.abs(normal.z),
    },
    (left, right) => right - left
  )
  if (!axis) {
    return undefined
  }

  return getFramePlaneForFeaturePlane(getFeaturePlaneForNormalAxis(axis))
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
  value: number,
  wasmInstance: ModuleType
): KclCommandValue {
  const valueText = `[${value}, ${value}]`
  return {
    valueAst: createArrayExpression([
      createLiteral(value, wasmInstance),
      createLiteral(value, wasmInstance),
    ]),
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
  engineCommandManager: ConnectionManager,
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

async function getDefaultGdtFramePlaneFromSelectionNormals({
  engineCommandManager,
  selections,
}: {
  engineCommandManager: ConnectionManager
  selections: Selections | undefined
}): Promise<GdtFramePlane | undefined> {
  const faceEntityIds = getPlanarFaceEntityIdsForGdtSelections(selections)

  for (const entityId of faceEntityIds) {
    const normal = await getPlanarFaceNormal(engineCommandManager, entityId)
    if (!normal) {
      continue
    }

    const framePlane = getDefaultGdtFramePlaneFromNormal(normal)
    if (framePlane) {
      return framePlane
    }
  }

  return undefined
}

async function getBoundingBoxForGdtSelections({
  engineCommandManager,
  entityIds,
  outputUnit,
}: {
  engineCommandManager: ConnectionManager
  entityIds: ArtifactId[]
  outputUnit: UnitLength
}): Promise<BoundingBox | undefined> {
  if (entityIds.length === 0) {
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
  outputUnit = DEFAULT_DEFAULT_LENGTH_UNIT,
  wasmInstance,
}: {
  data: T
  engineCommandManager: ConnectionManager
  outputUnit?: UnitLength
  wasmInstance: ModuleType
}): Promise<T> {
  const selections = getSelectionsFromGdtData(data)
  const entityIds = getEngineEntityIdsForGdtSelections(selections)
  let nextData = data
  let hasResolvedFramePlane = Boolean(data.framePlane)

  if (!data.framePlane) {
    const framePlaneFromNormal =
      await getDefaultGdtFramePlaneFromSelectionNormals({
        engineCommandManager,
        selections,
      })

    if (framePlaneFromNormal) {
      hasResolvedFramePlane = true
      if (framePlaneFromNormal !== KCL_PLANE_XY) {
        nextData = {
          ...nextData,
          framePlane: framePlaneFromNormal,
        }
      }
    }
  }

  if (nextData.framePosition && hasResolvedFramePlane) {
    return nextData
  }

  const boundingBox = await getBoundingBoxForGdtSelections({
    engineCommandManager,
    entityIds,
    outputUnit,
  })

  if (!boundingBox) {
    return nextData
  }

  if (!hasResolvedFramePlane) {
    const framePlaneFromBoundingBox = getDefaultGdtFramePlaneFromBoundingBox(
      boundingBox.dimensions
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

  if (!nextData.framePosition) {
    const averageDimension = getAverageBoundingBoxDimension(
      boundingBox.dimensions
    )
    if (averageDimension === undefined) {
      return nextData
    }

    nextData = {
      ...nextData,
      framePosition: createFramePositionCommandValue(
        averageDimension,
        wasmInstance
      ),
    }
  }

  return nextData
}
