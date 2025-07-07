import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createVariableDeclaration,
} from '@src/lang/create'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { Selections } from '@src/lib/selections'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  createPathToNodeForLastVariable,
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
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    objects,
    modifiedAst,
    nodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const xExpr = x ? [createLabeledArg('x', valueOrVariable(x))] : []
  const yExpr = y ? [createLabeledArg('y', valueOrVariable(y))] : []
  const zExpr = z ? [createLabeledArg('z', valueOrVariable(z))] : []
  const globalExpr = global
    ? [createLabeledArg('global', createLiteral(global))]
    : []

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
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
  const pathToNode = setCallInAst(
    modifiedAst,
    call,
    nodeToEdit,
    vars.pathIfPipe
  )
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
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    objects,
    modifiedAst,
    nodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const rollExpr = roll ? [createLabeledArg('roll', valueOrVariable(roll))] : []
  const pitchExpr = pitch
    ? [createLabeledArg('pitch', valueOrVariable(pitch))]
    : []
  const yawExpr = yaw ? [createLabeledArg('yaw', valueOrVariable(yaw))] : []
  const globalExpr = global
    ? [createLabeledArg('global', createLiteral(global))]
    : []

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
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
  const pathToNode = setCallInAst(
    modifiedAst,
    call,
    nodeToEdit,
    vars.pathIfPipe
  )
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

export function addClone({
  ast,
  artifactGraph,
  objects,
  variableName,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  variableName: string
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    objects,
    modifiedAst,
    nodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('clone', objectsExpr, [])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const declaration = createVariableDeclaration(variableName, call)
  modifiedAst.body.push(declaration)
  const toFirstKwarg = false
  const pathToNode = createPathToNodeForLastVariable(modifiedAst, toFirstKwarg)
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}
