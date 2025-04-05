import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createPipeExpression,
  createPipeSubstitution,
} from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import type {
  Expr,
  ExpressionStatement,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'

export function setTransform({
  ast,
  nodeToEdit,
  tx,
  ty,
  tz,
  rr,
  rp,
  ry,
}: {
  ast: Node<Program>
  nodeToEdit: PathToNode
  tx: Expr
  ty: Expr
  tz: Expr
  rr: Expr
  rp: Expr
  ry: Expr
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)

  const call = getNodeFromPath<ExpressionStatement>(
    modifiedAst,
    nodeToEdit,
    'ExpressionStatement'
  )
  if (err(call)) return call

  const declarator = call.node
  const translateCall = createCallExpressionStdLibKw(
    'translate',
    createPipeSubstitution(),
    [
      createLabeledArg('x', tx),
      createLabeledArg('y', ty),
      createLabeledArg('z', tz),
    ]
  )
  const rotateCall = createCallExpressionStdLibKw(
    'rotate',
    createPipeSubstitution(),
    [
      createLabeledArg('roll', rr),
      createLabeledArg('pitch', rp),
      createLabeledArg('yaw', ry),
    ]
  )
  // Modify the expression
  console.log('declaration.expression', declarator.expression)
  if (declarator.expression.type === 'Name') {
    // 1. case when no translate exists, mutate in place
    console.log('1. case when no translate exists, mutate in place')
    declarator.expression = createPipeExpression([
      declarator.expression,
      translateCall,
      rotateCall,
    ])
    console.log('after declaration expression')
  } else if (declarator.expression.type === 'PipeExpression') {
    // 2. case when translate exists or extrude in sketch pipe
    const existingTranslateIndex = declarator.expression.body.findIndex(
      (v) =>
        v.type === 'CallExpressionKw' &&
        v.callee.type === 'Name' &&
        v.callee.name.name === 'translate'
    )
    if (existingTranslateIndex > -1) {
      declarator.expression.body[existingTranslateIndex] = translateCall
    } else {
      declarator.expression.body.push(translateCall)
    }

    const existingRotateIndex = declarator.expression.body.findIndex(
      (v) =>
        v.type === 'CallExpressionKw' &&
        v.callee.type === 'Name' &&
        v.callee.name.name === 'rotate'
    )
    if (existingRotateIndex > -1) {
      declarator.expression.body[existingRotateIndex] = rotateCall
    } else {
      declarator.expression.body.push(rotateCall)
    }
  } else {
    return new Error('Unsupported operation type.')
  }

  return {
    modifiedAst,
    pathToNode: [], // TODO: fix
  }
}
