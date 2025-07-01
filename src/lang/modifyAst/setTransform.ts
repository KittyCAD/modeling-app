import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createPipeExpression,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { getNodeFromPath, getExprsFromSelection, valueOrVariable } from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  ExpressionStatement,
  PathToNode,
  PipeExpression,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import {
  findAllChildrenAndOrderByPlaceInCode,
  getLastVariable,
} from '@src/lang/modifyAst/boolean'
import type { Selections } from '@src/lib/selections'
import { KclCommandValue } from '@src/lib/commandTypes'
import { createPathToNode, createSketchExpression } from './addSweep'
import { insertVariableAndOffsetPathToNode } from '../modifyAst'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'

export function setTranslate({
  ast,
  objects,
  x,
  y,
  z,
  global,
  nodeToEdit,
}: {
  ast: Node<Program>
  objects: Selections
  x: KclCommandValue
  y: KclCommandValue
  z: KclCommandValue
  global?: boolean
  nodeToEdit: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const objectsExprList = getExprsFromSelection(
    objects,
    modifiedAst,
    nodeToEdit
  )
  if (err(objectsExprList)) {
    return objectsExprList
  }

  // Extra labeled args expression
  const globalExpr = global
    ? [createLabeledArg('global', createLiteral(global))]
    : []
   const objectsExpr = createSketchExpression(objectsExprList)
  const call = createCallExpressionStdLibKw('translate', objectsExpr, [
    createLabeledArg('x', valueOrVariable(x)),
    createLabeledArg('y', valueOrVariable(y)),
    createLabeledArg('z', valueOrVariable(z)),
    ...globalExpr,
  ])

  // Insert variables for labeled arguments if provided
  if ('variableName' in x && x.variableName) {
    insertVariableAndOffsetPathToNode(x, modifiedAst, nodeToEdit)
  }
  if ('variableName' in y && y.variableName) {
    insertVariableAndOffsetPathToNode(y, modifiedAst, nodeToEdit)
  }
  if ('variableName' in z && z.variableName) {
    insertVariableAndOffsetPathToNode(z, modifiedAst, nodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  let pathToNode: PathToNode | undefined
  if (nodeToEdit) {
    const result = getNodeFromPath<CallExpressionKw>(
      modifiedAst,
      nodeToEdit,
      'CallExpressionKw'
    )
    if (err(result)) {
      return result
    }

    Object.assign(result.node, call)
    pathToNode = nodeToEdit
  } else {
    const name = findUniqueName(
      modifiedAst,
      KCL_DEFAULT_CONSTANT_PREFIXES.TRANSLATE,
    )
    const declaration = createVariableDeclaration(name, call)
    modifiedAst.body.push(declaration)
    pathToNode = createPathToNode(modifiedAst)
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function setRotate({
  modifiedAst,
  pathToNode,
  roll,
  pitch,
  yaw,
  global,
}: {
  modifiedAst: Node<Program>
  pathToNode: PathToNode
  roll: Expr
  pitch: Expr
  yaw: Expr
  global?: boolean
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Extra labeled args expression
  const globalExpr = global
    ? [createLabeledArg('global', createLiteral(global))]
    : []
  const noPercentSign = null
  const call = createCallExpressionStdLibKw('rotate', noPercentSign, [
    createLabeledArg('roll', roll),
    createLabeledArg('pitch', pitch),
    createLabeledArg('yaw', yaw),
    ...globalExpr,
  ])

  const potentialPipe = getNodeFromPath<PipeExpression>(
    modifiedAst,
    pathToNode,
    ['PipeExpression']
  )
  if (!err(potentialPipe) && potentialPipe.node.type === 'PipeExpression') {
    setTransformInPipe(potentialPipe.node, call)
  } else {
    const error = createPipeWithTransform(modifiedAst, pathToNode, call)
    if (err(error)) {
      return error
    }
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function setScale({
  modifiedAst,
  pathToNode,
  x,
  y,
  z,
  global,
}: {
  modifiedAst: Node<Program>
  pathToNode: PathToNode
  x: Expr
  y: Expr
  z: Expr
  global?: boolean
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Extra labeled args expression
  const globalExpr = global
    ? [createLabeledArg('global', createLiteral(global))]
    : []
  const noPercentSign = null
  const call = createCallExpressionStdLibKw('scale', noPercentSign, [
    createLabeledArg('x', x),
    createLabeledArg('y', y),
    createLabeledArg('z', z),
    ...globalExpr,
  ])

  const potentialPipe = getNodeFromPath<PipeExpression>(
    modifiedAst,
    pathToNode,
    ['PipeExpression']
  )
  if (!err(potentialPipe) && potentialPipe.node.type === 'PipeExpression') {
    setTransformInPipe(potentialPipe.node, call)
  } else {
    const error = createPipeWithTransform(modifiedAst, pathToNode, call)
    if (err(error)) {
      return error
    }
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

function setTransformInPipe(
  expression: PipeExpression,
  call: Node<CallExpressionKw>
) {
  const existingIndex = expression.body.findIndex(
    (v) =>
      v.type === 'CallExpressionKw' &&
      v.callee.type === 'Name' &&
      v.callee.name.name === call.callee.name.name
  )
  if (existingIndex > -1) {
    expression.body[existingIndex] = call
  } else {
    expression.body.push(call)
  }
}

function createPipeWithTransform(
  modifiedAst: Node<Program>,
  pathToNode: PathToNode,
  call: Node<CallExpressionKw>
) {
  const existingCall = getNodeFromPath<
    VariableDeclarator | ExpressionStatement
  >(modifiedAst, pathToNode, ['VariableDeclarator', 'ExpressionStatement'])
  if (err(existingCall)) {
    return new Error('Unsupported operation type.')
  }

  if (existingCall.node.type === 'ExpressionStatement') {
    existingCall.node.expression = createPipeExpression([
      existingCall.node.expression,
      call,
    ])
  } else if (existingCall.node.type === 'VariableDeclarator') {
    existingCall.node.init = createPipeExpression([
      existingCall.node.init,
      call,
    ])
  } else {
    return new Error('Unsupported operation type.')
  }
}

export function insertExpressionNode(ast: Node<Program>, alias: string) {
  const expression = createExpressionStatement(createLocalName(alias))
  ast.body.push(expression)
  const pathToNode: PathToNode = [
    ['body', ''],
    [ast.body.length - 1, 'index'],
    ['expression', 'Name'],
  ]
  return pathToNode
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
