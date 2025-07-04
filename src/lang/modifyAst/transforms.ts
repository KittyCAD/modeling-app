import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
} from '@src/lang/create'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import {
  findAllChildrenAndOrderByPlaceInCode,
  getLastVariable,
} from '@src/lang/modifyAst/boolean'
import type { Selections } from '@src/lib/selections'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  createVariableExpressionsArray,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'

export function addTranslate({
  ast,
  artifactGraph,
  objects,
  x,
  y,
  z,
  global,
  nodeToEdit,
  callName,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  x?: KclCommandValue
  y?: KclCommandValue
  z?: KclCommandValue
  global?: boolean
  nodeToEdit?: PathToNode
  callName?: string
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const variableExpressions = getVariableExprsFromSelection(
    objects,
    modifiedAst,
    nodeToEdit,
    true,
    artifactGraph
  )
  if (err(variableExpressions)) {
    return variableExpressions
  }

  const xExpr = x ? [createLabeledArg('x', valueOrVariable(x))] : []
  const yExpr = y ? [createLabeledArg('y', valueOrVariable(y))] : []
  const zExpr = z ? [createLabeledArg('z', valueOrVariable(z))] : []
  const globalExpr = global
    ? [createLabeledArg('global', createLiteral(global))]
    : []

  const objectsExpr = createVariableExpressionsArray(variableExpressions.exprs)
  const call = createCallExpressionStdLibKw(
    callName ?? 'translate',
    objectsExpr,
    [...xExpr, ...yExpr, ...zExpr, ...globalExpr]
  )

  // Insert variables for labeled arguments if provided
  if (x && 'variableName' in x && x.variableName) {
    insertVariableAndOffsetPathToNode(x, modifiedAst, nodeToEdit)
  }
  if (y && 'variableName' in y && y.variableName) {
    insertVariableAndOffsetPathToNode(y, modifiedAst, nodeToEdit)
  }
  if (z && 'variableName' in z && z.variableName) {
    insertVariableAndOffsetPathToNode(z, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const lastPath = variableExpressions.paths.pop() // TODO: check if this is correct
  const pathToNode = setCallInAst(modifiedAst, call, nodeToEdit, lastPath)
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addRotate({
  ast,
  artifactGraph,
  objects,
  roll,
  pitch,
  yaw,
  global,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  roll?: KclCommandValue
  pitch?: KclCommandValue
  yaw?: KclCommandValue
  global?: boolean
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const variableExpressions = getVariableExprsFromSelection(
    objects,
    modifiedAst,
    nodeToEdit,
    true,
    artifactGraph
  )
  if (err(variableExpressions)) {
    return variableExpressions
  }

  const rollExpr = roll ? [createLabeledArg('roll', valueOrVariable(roll))] : []
  const pitchExpr = pitch
    ? [createLabeledArg('pitch', valueOrVariable(pitch))]
    : []
  const yawExpr = yaw ? [createLabeledArg('yaw', valueOrVariable(yaw))] : []
  const globalExpr = global
    ? [createLabeledArg('global', createLiteral(global))]
    : []

  const objectsExpr = createVariableExpressionsArray(variableExpressions.exprs)
  const call = createCallExpressionStdLibKw('rotate', objectsExpr, [
    ...rollExpr,
    ...pitchExpr,
    ...yawExpr,
    ...globalExpr,
  ])

  // Insert variables for labeled arguments if provided
  if (roll && 'variableName' in roll && roll.variableName) {
    insertVariableAndOffsetPathToNode(roll, modifiedAst, nodeToEdit)
  }
  if (pitch && 'variableName' in pitch && pitch.variableName) {
    insertVariableAndOffsetPathToNode(pitch, modifiedAst, nodeToEdit)
  }
  if (yaw && 'variableName' in yaw && yaw.variableName) {
    insertVariableAndOffsetPathToNode(yaw, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const lastPath = variableExpressions.paths.pop() // TODO: check if this is correct
  const pathToNode = setCallInAst(modifiedAst, call, nodeToEdit, lastPath)
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addScale({
  ast,
  artifactGraph,
  objects,
  x,
  y,
  z,
  global,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  x?: KclCommandValue
  y?: KclCommandValue
  z?: KclCommandValue
  global?: boolean
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addTranslate({
    ast,
    artifactGraph,
    objects,
    x,
    y,
    z,
    global,
    nodeToEdit,
    callName: 'scale',
  })
}

export function retrievePathToNodeFromTransformSelection(
  selection: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>
): PathToNode | Error {
  const error = new Error(
    "Couldn't retrieve selection. If you're trying to transform an import, use the feature tree."
  )
  const hasPathToNode = !!selection.graphSelections[0].codeRef.pathToNode.length
  const artifact = selection.graphSelections[0].artifact
  let pathToNode: PathToNode | undefined
  if (hasPathToNode && artifact) {
    const children = findAllChildrenAndOrderByPlaceInCode(
      artifact,
      artifactGraph
    )
    const variable = getLastVariable(children, ast)
    if (!variable) {
      return error
    }

    pathToNode = variable.pathToNode
  } else if (hasPathToNode) {
    pathToNode = selection.graphSelections[0].codeRef.pathToNode
  } else {
    return error
  }

  return pathToNode
}
