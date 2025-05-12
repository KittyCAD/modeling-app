import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLocalName,
  createPipeExpression,
} from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
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
