import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createCallExpressionStdLibKw,
  createLabeledArg,
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

export const planeMethodArgs = {
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
  ...values
}: ConstructionPlaneCommandArgs & {
  ast: Node<Program>
  wasmInstance: ModuleType
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const editPath = structuredClone(nodeToEdit)
  const labeledArgs = []
  for (const name of planeMethodArgs[method]) {
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
