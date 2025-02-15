import { PathToNode, Program } from 'lang/wasm'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { locateExtrudeDeclarator } from './addEdgeTreatment'
import { err } from 'lib/trap'
import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createPipeExpression,
} from 'lang/modifyAst'
import { createPipeSubstitution } from 'lang/modifyAst'

export function setAppearance({
  ast,
  nodeToEdit,
  color,
}: {
  ast: Node<Program>
  nodeToEdit: PathToNode
  color: string
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)

  // Locate the call (not necessarily an extrude here)
  const result = locateExtrudeDeclarator(modifiedAst, nodeToEdit)
  if (err(result)) {
    return result
  }

  const declarator = result.extrudeDeclarator
  const call = createCallExpressionStdLibKw(
    'appearance',
    createPipeSubstitution(),
    [createLabeledArg('color', createLiteral(color))]
  )
  // Modify the expression
  if (
    declarator.init.type === 'CallExpression' ||
    declarator.init.type === 'CallExpressionKw'
  ) {
    // 1. case when no appearance exists, mutate in place
    declarator.init = createPipeExpression([declarator.init, call])
  } else if (declarator.init.type === 'PipeExpression') {
    // 2. case when appearance exists or extrude in sketch pipe
    const existingIndex = declarator.init.body.findIndex(
      (v) =>
        v.type === 'CallExpressionKw' &&
        v.callee.type === 'Identifier' &&
        v.callee.name === 'appearance'
    )
    if (existingIndex > -1) {
      declarator.init.body[existingIndex] = call
    } else {
      declarator.init.body.push(call)
    }
  } else {
    return new Error('Unsupported operation type.')
  }

  return {
    modifiedAst,
    pathToNode: nodeToEdit,
  }
}
