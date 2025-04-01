import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createPipeExpression,
  createPipeSubstitution,
} from '@src/lang/modifyAst'
import { locateExtrudeDeclarator } from '@src/lang/modifyAst/addEdgeTreatment'
import type { PathToNode, Program } from '@src/lang/wasm'
import { COMMAND_APPEARANCE_COLOR_DEFAULT } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { err } from '@src/lib/trap'

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
        v.callee.type === 'Name' &&
        v.callee.name.name === 'appearance'
    )
    if (existingIndex > -1) {
      if (color === COMMAND_APPEARANCE_COLOR_DEFAULT) {
        // Special case of unsetting the appearance aka deleting the node
        declarator.init.body.splice(existingIndex, 1)
      } else {
        declarator.init.body[existingIndex] = call
      }
    } else {
      declarator.init.body.push(call)
    }
  } else {
    return new Error('Unsupported operation type.')
  }

  return {
    modifiedAst,
    pathToNode: result.shallowPath,
  }
}
