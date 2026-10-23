import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
} from '@src/lang/create'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { valueOrVariable } from '@src/lang/queryAst'
import type { PathToNode, Program } from '@src/lang/wasm'
import type { ConstructionPlaneCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { validatePlanePoints } from '@src/lib/vertexPicking'
import type { PickedPoint } from '@src/lib/vertexPicking'
import {
  inferReferencePlane,
  resolveReferencePlane,
} from '@src/lib/referencePlanes'
import type { KclManager } from '@src/lang/KclManager'

export const planeMethodArgs = {
  References: [],
  Axes: ['origin', 'xAxis', 'yAxis'],
  Normal: ['origin', 'normal', 'xAxis'],
  Points: ['points'],
  Equation: ['a', 'b', 'c', 'd', 'xAxis'],
} as const

export function addConstructionPlane({
  ast,
  wasmInstance,
  nodeToEdit,
  method,
  pointSource,
  pickedPoints,
  references: _references,
  offset: _offset,
  ...values
}: ConstructionPlaneCommandArgs & {
  ast: Node<Program>
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const editPath = structuredClone(nodeToEdit)
  const labeledArgs = []
  if (method === 'Points' && pointSource === 'Pick') {
    const selections = pickedPoints?.graphSelections ?? []
    if (
      pickedPoints?.otherSelections.length ||
      selections.some(
        (s) => s.entityRef?.type !== 'vertex' || !s.vertexPosition
      )
    )
      return new Error('Select exactly three corner points on the part.')
    const points = selections.map((s) => s.vertexPosition) as PickedPoint[]
    const valid = validatePlanePoints(points)
    if (isErr(valid)) return valid
    labeledArgs.push(
      createLabeledArg(
        'points',
        createArrayExpression(
          points.map((point) =>
            createArrayExpression(
              point.map((coordinate) =>
                createLiteral(coordinate, wasmInstance, 'Mm')
              )
            )
          )
        )
      )
    )
  }
  for (const name of planeMethodArgs[method]) {
    if (name === 'points' && pointSource === 'Pick') continue
    const value = values[name]
    if (!value) return new Error(`Missing plane argument: ${name}`)
    if ('variableName' in value && value.variableName) {
      insertVariableAndOffsetPathToNode(value, modifiedAst, editPath)
    }
    labeledArgs.push(createLabeledArg(name, valueOrVariable(value)))
  }
  const call = createCallExpressionStdLibKw('plane', null, labeledArgs)
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: editPath,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.PLANE,
    wasmInstance,
  })
  if (isErr(pathToNode)) return pathToNode
  return { modifiedAst, pathToNode }
}

export async function addReferencePlane({
  ast,
  wasmInstance,
  kclManager,
  references,
  offset,
  nodeToEdit,
}: {
  ast: Node<Program>
  wasmInstance: ModuleType
  kclManager: KclManager
  references?: ConstructionPlaneCommandArgs['references']
  offset?: ConstructionPlaneCommandArgs['offset']
  nodeToEdit?: PathToNode
}) {
  const kind = inferReferencePlane(references)
  if (isErr(kind)) return kind
  if (!references) return new Error('Select reference geometry.')
  const sourceAst = kclManager.ast
  const graph = kclManager.artifactGraph
  const frame = await resolveReferencePlane(
    references,
    kclManager.variables,
    kclManager.engineCommandManager,
    kclManager.sceneInfra.baseUnitMultiplier
  )
  if (kclManager.ast !== sourceAst || kclManager.artifactGraph !== graph)
    return new Error(
      'The model changed while reading the references. Select them again.'
    )
  if (isErr(frame)) return frame
  const modifiedAst = structuredClone(ast)
  const editPath = structuredClone(nodeToEdit)
  const coordinates = (values: PickedPoint, length = false) =>
    createArrayExpression(
      values.map((value) =>
        createLiteral(value, wasmInstance, length ? 'Mm' : undefined)
      )
    )
  const base = createCallExpressionStdLibKw('plane', null, [
    createLabeledArg('origin', coordinates(frame.origin, true)),
    createLabeledArg('normal', coordinates(frame.normal)),
    createLabeledArg('xAxis', coordinates(frame.xAxis)),
  ])
  if (kind === 'Offset' && !offset)
    return new Error('Enter the plane offset distance.')
  if (
    kind === 'Offset' &&
    offset &&
    'variableName' in offset &&
    offset.variableName
  )
    insertVariableAndOffsetPathToNode(offset, modifiedAst, editPath)
  const call =
    kind === 'Offset' && offset
      ? createCallExpressionStdLibKw('offsetPlane', base, [
          createLabeledArg('offset', valueOrVariable(offset)),
        ])
      : base
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: editPath,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.PLANE,
    wasmInstance,
  })
  return isErr(pathToNode) ? pathToNode : { modifiedAst, pathToNode }
}
