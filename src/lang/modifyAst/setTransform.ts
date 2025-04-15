import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
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

export function setTransform({
  ast,
  pathToNode,
  tx,
  ty,
  tz,
  rr,
  rp,
  ry,
}: {
  ast: Node<Program>
  pathToNode: PathToNode
  tx: Expr
  ty: Expr
  tz: Expr
  rr: Expr
  rp: Expr
  ry: Expr
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)

  const noPercentSign = null
  const translateCall = createCallExpressionStdLibKw(
    'translate',
    noPercentSign,
    [
      createLabeledArg('x', tx),
      createLabeledArg('y', ty),
      createLabeledArg('z', tz),
    ]
  )

  const rotateCall = createCallExpressionStdLibKw('rotate', noPercentSign, [
    createLabeledArg('roll', rr),
    createLabeledArg('pitch', rp),
    createLabeledArg('yaw', ry),
  ])

  const potentialPipe = getNodeFromPath<PipeExpression>(
    modifiedAst,
    pathToNode,
    ['PipeExpression']
  )
  if (!err(potentialPipe) && potentialPipe.node.type === 'PipeExpression') {
    setTransformInPipe(potentialPipe.node, translateCall, rotateCall)
  } else {
    const call = getNodeFromPath<VariableDeclarator | ExpressionStatement>(
      modifiedAst,
      pathToNode,
      ['VariableDeclarator', 'ExpressionStatement']
    )
    if (err(call)) {
      return new Error('Unsupported operation type.')
    }

    if (call.node.type === 'ExpressionStatement') {
      call.node.expression = createPipeExpression([
        call.node.expression,
        translateCall,
        rotateCall,
      ])
    } else if (call.node.type === 'VariableDeclarator') {
      call.node.init = createPipeExpression([
        call.node.init,
        translateCall,
        rotateCall,
      ])
    } else {
      return new Error('Unsupported operation type.')
    }
  }

  return {
    modifiedAst,
    pathToNode, // TODO: fix
  }
}

function setTransformInPipe(
  expression: PipeExpression,
  translateCall: Node<CallExpressionKw>,
  rotateCall: Node<CallExpressionKw>
) {
  const existingTranslateIndex = expression.body.findIndex(
    (v) =>
      v.type === 'CallExpressionKw' &&
      v.callee.type === 'Name' &&
      v.callee.name.name === 'translate'
  )
  if (existingTranslateIndex > -1) {
    expression.body[existingTranslateIndex] = translateCall
  } else {
    expression.body.push(translateCall)
  }

  const existingRotateIndex = expression.body.findIndex(
    (v) =>
      v.type === 'CallExpressionKw' &&
      v.callee.type === 'Name' &&
      v.callee.name.name === 'rotate'
  )
  if (existingRotateIndex > -1) {
    expression.body[existingRotateIndex] = rotateCall
  } else {
    expression.body.push(rotateCall)
  }
}
