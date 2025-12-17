import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
} from '@src/lang/create'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { getAxisExpressionAndIndex } from '@src/lang/modifyAst/sweeps'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  Expr,
  LabeledArg,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function addHelix({
  ast,
  artifactGraph,
  wasmInstance,
  axis,
  edge,
  cylinder,
  revolutions,
  angleStart,
  radius,
  length,
  ccw,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  wasmInstance: ModuleType
  axis?: string
  cylinder?: Selections
  edge?: Selections
  revolutions: KclCommandValue
  angleStart: KclCommandValue
  radius?: KclCommandValue
  length?: KclCommandValue
  ccw?: boolean
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  let pathIfNewPipe: PathToNode | undefined
  const axisExpr: LabeledArg[] = []
  const cylinderExpr: LabeledArg[] = []
  if (cylinder) {
    const lastChildLookup = true
    const vars = getVariableExprsFromSelection(
      cylinder,
      modifiedAst,
      mNodeToEdit,
      lastChildLookup,
      artifactGraph
    )
    if (err(vars)) {
      return vars
    }
    cylinderExpr.push(createLabeledArg('cylinder', vars.exprs[0]))
    pathIfNewPipe = vars.pathIfPipe
  } else if (axis || edge) {
    const result = getAxisExpressionAndIndex(axis, edge, modifiedAst)
    if (err(result)) {
      return result
    }
    axisExpr.push(createLabeledArg('axis', result.generatedAxis as Expr))
  } else {
    return new Error('Helix must have either an axis or a cylinder')
  }

  // Optional args
  const ccwExpr = ccw
    ? [createLabeledArg('ccw', createLiteral(ccw, wasmInstance))]
    : []
  const radiusExpr = radius
    ? [createLabeledArg('radius', valueOrVariable(radius))]
    : []
  const lengthExpr = length
    ? [createLabeledArg('length', valueOrVariable(length))]
    : []

  const unlabeledArgs = null
  const call = createCallExpressionStdLibKw('helix', unlabeledArgs, [
    ...axisExpr,
    ...cylinderExpr,
    createLabeledArg('revolutions', valueOrVariable(revolutions)),
    createLabeledArg('angleStart', valueOrVariable(angleStart)),
    ...radiusExpr,
    ...lengthExpr,
    ...ccwExpr,
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in angleStart && angleStart.variableName) {
    insertVariableAndOffsetPathToNode(angleStart, modifiedAst, mNodeToEdit)
  }

  if ('variableName' in revolutions && revolutions.variableName) {
    insertVariableAndOffsetPathToNode(revolutions, modifiedAst, mNodeToEdit)
  }

  if (radius && 'variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, mNodeToEdit)
  }

  if (length && 'variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.HELIX,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}
