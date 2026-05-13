import type { BoundingBox } from '@kittycad/lib'

import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createArrayExpression, createLiteral } from '@src/lang/create'
import { toUtf16 } from '@src/lang/errors'
import { traverse } from '@src/lang/queryAst'
import type {
  ArtifactId,
  CallExpressionKw,
  Expr,
  Program,
} from '@src/lang/wasm'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { roundOff, uuidv4 } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'

type GdtCommandData =
  | ModelingCommandSchema['GDT Flatness']
  | ModelingCommandSchema['GDT Datum']
  | ModelingCommandSchema['GDT Position']
  | ModelingCommandSchema['GDT Profile']
  | ModelingCommandSchema['GDT Distance']
  | ModelingCommandSchema['GDT Perpendicularity']
  | ModelingCommandSchema['GDT Parallelism']
  | ModelingCommandSchema['GDT Annotation']

export const GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO = 0.2

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

function isGdtCall(node: unknown): node is Node<CallExpressionKw> {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    node.type === 'CallExpressionKw' &&
    'callee' in node &&
    typeof node.callee === 'object' &&
    node.callee !== null &&
    'type' in node.callee &&
    node.callee.type === 'Name' &&
    'path' in node.callee &&
    Array.isArray(node.callee.path) &&
    node.callee.path.length === 1 &&
    node.callee.path[0]?.name === 'gdt'
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

  traverse(ast, {
    enter: (node) => {
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
    },
  })

  return fontSize
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

  return [...new Set(entityIds)]
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

function createFontSizeCommandValue(
  averageDimension: number,
  outputUnit: UnitLength,
  wasmInstance: ModuleType
): KclCommandValue {
  const value = roundOff(
    averageDimension * GDT_FONT_SIZE_TO_BOUNDING_BOX_AVERAGE_RATIO,
    4
  )
  const valueText = `${value}${outputUnit}`

  return {
    valueAst: createLiteral(
      value,
      wasmInstance,
      baseUnitToNumericSuffix(outputUnit),
      4
    ),
    valueCalculated: valueText,
    valueText,
  }
}

export async function withDefaultGdtFramePosition<T extends GdtCommandData>({
  data,
  engineCommandManager,
  ast,
  sourceCode,
  outputUnit = DEFAULT_DEFAULT_LENGTH_UNIT,
  wasmInstance,
}: {
  data: T
  engineCommandManager: ConnectionManager
  ast?: Node<Program>
  sourceCode?: string
  outputUnit?: UnitLength
  wasmInstance: ModuleType
}): Promise<T> {
  const existingFontSize = data.fontSize
    ? undefined
    : getExistingGdtFontSize(ast, sourceCode)
  const dataWithExistingFontSize =
    existingFontSize === undefined
      ? data
      : {
          ...data,
          fontSize: existingFontSize,
        }

  if (
    dataWithExistingFontSize.framePosition &&
    dataWithExistingFontSize.fontSize
  ) {
    return dataWithExistingFontSize
  }

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

    if (!isModelingResponse(response)) {
      return dataWithExistingFontSize
    }

    const modelingResponse = response.resp.data.modeling_response
    if (modelingResponse.type !== 'bounding_box') {
      return dataWithExistingFontSize
    }

    const averageDimension = getAverageBoundingBoxDimension(
      modelingResponse.data.dimensions
    )
    if (averageDimension === undefined) {
      return dataWithExistingFontSize
    }

    return {
      ...dataWithExistingFontSize,
      ...(dataWithExistingFontSize.framePosition
        ? {}
        : {
            framePosition: createFramePositionCommandValue(
              averageDimension,
              wasmInstance
            ),
          }),
      ...(dataWithExistingFontSize.fontSize
        ? {}
        : {
            fontSize: createFontSizeCommandValue(
              averageDimension,
              outputUnit,
              wasmInstance
            ),
          }),
    }
  } catch {
    return dataWithExistingFontSize
  }
}
