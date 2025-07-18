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
import type { Selections } from '@src/lib/selections'
import { err } from '@src/lib/trap'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { getAxisExpressionAndIndex } from '@src/lang/modifyAst/sweeps'

/**
 * Append a helix to the AST
 */
export function addHelix({
  ast,
  artifactGraph,
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
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

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
      nodeToEdit,
      lastChildLookup,
      artifactGraph
    )
    if (err(vars)) {
      return vars
    }
    cylinderExpr.push(createLabeledArg('cylinder', vars.exprs[0]))
    pathIfNewPipe = vars.pathIfPipe
  } else if (axis || edge) {
    const result = getAxisExpressionAndIndex(
      edge ? 'Edge' : 'Axis',
      axis,
      edge,
      modifiedAst
    )
    if (err(result)) {
      return result
    }
    axisExpr.push(createLabeledArg('axis', result.generatedAxis as Expr))
  } else {
    return new Error('Helix must have either an axis or a cylinder')
  }

  // Optional args
  const ccwExpr = ccw ? [createLabeledArg('ccw', createLiteral(ccw))] : []
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
    ...radiusExpr,
    ...lengthExpr,
    createLabeledArg('revolutions', valueOrVariable(revolutions)),
    createLabeledArg('angleStart', valueOrVariable(angleStart)),
    ...ccwExpr,
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in angleStart && angleStart.variableName) {
    insertVariableAndOffsetPathToNode(angleStart, modifiedAst, nodeToEdit)
  }

  if ('variableName' in revolutions && revolutions.variableName) {
    insertVariableAndOffsetPathToNode(revolutions, modifiedAst, nodeToEdit)
  }

  if (radius && 'variableName' in radius && radius.variableName) {
    insertVariableAndOffsetPathToNode(radius, modifiedAst, nodeToEdit)
  }

  if (length && 'variableName' in length && length.variableName) {
    insertVariableAndOffsetPathToNode(length, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: nodeToEdit,
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
