import type { BoundingBox } from '@kittycad/lib'

import { createArrayExpression, createLiteral } from '@src/lang/create'
import type { ArtifactId } from '@src/lang/wasm'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { roundOff, uuidv4 } from '@src/lib/utils'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

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
  if ('objects' in data) return data.objects
  if ('faces' in data) return data.faces
  if ('edges' in data) return data.edges
  return undefined
}

export function getEngineEntityIdsForGdtSelections(
  selections: Selections | undefined
): ArtifactId[] {
  if (!selections) return []

  const entityIds = selections.graphSelections.flatMap((selection) => {
    if (selection.engineEntityId) return [selection.engineEntityId]

    const artifact = selection.artifact
    if (!artifact?.id) return []

    if (artifact.type !== 'pattern') return [artifact.id]

    return [
      ...artifact.copyIds,
      ...artifact.copyFaceIds,
      ...artifact.copyEdgeIds,
    ]
  })

  return [...new Set(entityIds)]
}

export function getAverageBoundingBoxDimension(
  dimensions: BoundingBox['dimensions']
): number | undefined {
  const nonZeroDimensions = [dimensions.x, dimensions.y, dimensions.z].filter(
    (dimension) => Number.isFinite(dimension) && dimension > 0
  )

  if (nonZeroDimensions.length === 0) return undefined

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

export async function withDefaultGdtFramePosition<T extends GdtCommandData>({
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
  if (data.framePosition) return data

  const selections = getSelectionsFromGdtData(data)
  const entityIds = getEngineEntityIdsForGdtSelections(selections)

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

    if (!isModelingResponse(response)) return data

    const modelingResponse = response.resp.data.modeling_response
    if (modelingResponse.type !== 'bounding_box') return data

    const averageDimension = getAverageBoundingBoxDimension(
      modelingResponse.data.dimensions
    )
    if (averageDimension === undefined) return data

    return {
      ...data,
      framePosition: createFramePositionCommandValue(
        averageDimension,
        wasmInstance
      ),
    }
  } catch {
    return data
  }
}
