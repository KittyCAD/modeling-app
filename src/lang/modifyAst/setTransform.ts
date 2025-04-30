import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
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
  CallExpressionKw,
  Expr,
  ExpressionStatement,
  PathToNode,
  PipeExpression,
  Program,
  VariableDeclarator,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'

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
    pathToNode, // TODO: check if this should be updated
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
    pathToNode, // TODO: check if this should be updated
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

/* Starting form the path to the import node, look for the first pipe expression
 * that uses the import alias. If found, return the pipe expression and the
 * path to the pipe node, and the alias. Wrote for the assemblies codemods.
 * Gotcha: doesn't support multiple pipe expressions for the same alias.
 */
export function findFirstPipeWithImportAlias(
  ast: Node<Program>,
  pathToNode: PathToNode,
  filterInPipe?: string
) {
  let pipe: PipeExpression | undefined
  let pathToPipeNode: PathToNode | undefined
  let alias: string | undefined
  const importNode = getNodeFromPath<ImportStatement>(ast, pathToNode, [
    'ImportStatement',
  ])
  if (
    !err(importNode) &&
    importNode.node.type === 'ImportStatement' &&
    importNode.node.selector.type === 'None' &&
    importNode.node.selector.alias &&
    importNode.node.selector.alias?.type === 'Identifier'
  ) {
    alias = importNode.node.selector.alias.name
    for (const [i, n] of ast.body.entries()) {
      if (
        n.type === 'ExpressionStatement' &&
        n.expression.type === 'PipeExpression' &&
        n.expression.body[0].type === 'Name' &&
        n.expression.body[0].name.name === alias
      ) {
        if (filterInPipe) {
          const containsFilter = n.expression.body.some(
            (v) =>
              v.type === 'CallExpressionKw' &&
              v.callee.name.name === filterInPipe
          )
          if (!containsFilter) {
            continue
          }
        }
        pipe = n.expression
        pathToPipeNode = [
          ['body', ''],
          [i, 'index'],
          ['expression', 'PipeExpression'],
        ]
        break
      }

      if (
        n.type === 'VariableDeclaration' &&
        n.declaration.type === 'VariableDeclarator' &&
        n.declaration.init.type === 'PipeExpression' &&
        n.declaration.init.body[0].type === 'Name' &&
        n.declaration.init.body[0].name.name === alias
      ) {
        pipe = n.declaration.init
        pathToPipeNode = [
          ['body', ''],
          [i, 'index'],
          ['declaration', 'VariableDeclaration'],
          ['init', 'VariableDeclarator'],
          ['body', 'PipeExpression'],
        ]
        break
      }
    }
  }

  return { pipe, pathToPipeNode, alias }
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
