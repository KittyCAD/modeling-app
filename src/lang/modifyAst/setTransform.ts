import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLocalName,
  createPipeExpression,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import { getNodeFromPath, valueOrVariable } from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  CallExpressionKw,
  Expr,
  ExpressionStatement,
  PathToNode,
  PipeExpression,
  Program,
  VariableDeclaration,
  VariableDeclarator,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import {
  findAllChildrenAndOrderByPlaceInCode,
  getLastVariable,
} from '@src/lang/modifyAst/boolean'
import type { Selections } from '@src/lib/selections'
import { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import { KclCommandValue } from '@src/lib/commandTypes'
import { insertVariableAndOffsetPathToNode } from '../modifyAst'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { createPathToNode } from './addSweep'

export function addTranslate({
  ast,
  artifactGraph,
  selection,
  x,
  y,
  z,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  selection: Selections
  x: KclCommandValue
  y: KclCommandValue
  z: KclCommandValue
  nodeToEdit?: PathToNode
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  // 1. Clone the ast so we can edit it
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const geometryNode = retrievePathToNodeFromTransformSelection(
    selection,
    artifactGraph,
    ast
  )
  if (err(geometryNode)) {
    return geometryNode
  }

  const geometryName = retrieveGeometryNameFromPath(ast, geometryNode)
  if (err(geometryName)) {
    return geometryName
  }

  const geometryExpr = createLocalName(geometryName)
  const call = createCallExpressionStdLibKw('translate', geometryExpr, [
    createLabeledArg('x', valueOrVariable(x)),
    createLabeledArg('y', valueOrVariable(y)),
    createLabeledArg('z', valueOrVariable(z)),
  ])

  // Insert variables for labeled arguments if provided
  insertVariableAndOffsetPathToNode(x, modifiedAst, nodeToEdit)
  insertVariableAndOffsetPathToNode(y, modifiedAst, nodeToEdit)
  insertVariableAndOffsetPathToNode(z, modifiedAst, nodeToEdit)

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
      KCL_DEFAULT_CONSTANT_PREFIXES.TRANSLATE
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

export function setTranslate({
  modifiedAst,
  pathToNode,
  x,
  y,
  z,
}: {
  modifiedAst: Node<Program>
  pathToNode: PathToNode
  x: Expr
  y: Expr
  z: Expr
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const noPercentSign = null
  const call = createCallExpressionStdLibKw('translate', noPercentSign, [
    createLabeledArg('x', x),
    createLabeledArg('y', y),
    createLabeledArg('z', z),
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

export function setRotate({
  modifiedAst,
  pathToNode,
  roll,
  pitch,
  yaw,
}: {
  modifiedAst: Node<Program>
  pathToNode: PathToNode
  roll: Expr
  pitch: Expr
  yaw: Expr
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const noPercentSign = null
  const call = createCallExpressionStdLibKw('rotate', noPercentSign, [
    createLabeledArg('roll', roll),
    createLabeledArg('pitch', pitch),
    createLabeledArg('yaw', yaw),
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

export function retrieveGeometryNameFromPath(
  ast: Node<Program>,
  pathToNode: PathToNode
) {
  const returnEarly = true
  const geometryNode = getNodeFromPath<
    VariableDeclaration | ImportStatement | PipeExpression
  >(
    ast,
    pathToNode,
    ['VariableDeclaration', 'ImportStatement', 'PipeExpression'],
    returnEarly
  )
  if (err(geometryNode)) {
    return new Error("Couldn't find corresponding path to node")
  }

  let geometryName: string | undefined
  if (geometryNode.node.type === 'VariableDeclaration') {
    geometryName = geometryNode.node.declaration.id.name
  } else if (
    geometryNode.node.type === 'ImportStatement' &&
    geometryNode.node.selector.type === 'None' &&
    geometryNode.node.selector.alias
  ) {
    geometryName = geometryNode.node.selector.alias?.name
  } else {
    return new Error("Couldn't find corresponding geometry")
  }

  return geometryName
}
