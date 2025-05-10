import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { PathToNode, Program } from '@src/lang/wasm'
import { locateVariableWithCallOrPipe } from '@src/lang/queryAst'
import { err } from '@src/lib/trap'

export function deleteNodeInExtrudePipe(
  ast: Node<Program>,
  node: PathToNode
): Error | void {
  const pipeIndex = node.findIndex(([_, type]) => type === 'PipeExpression') + 1
  if (!(node[pipeIndex][0] && typeof node[pipeIndex][0] === 'number')) {
    return new Error("Couldn't find node to delete in ast")
  }

  const lookup = locateVariableWithCallOrPipe(ast, node)
  if (err(lookup)) {
    return lookup
  }

  if (lookup.variableDeclarator.init.type !== 'PipeExpression') {
    return new Error("Couldn't find node to delete in looked up extrusion")
  }

  lookup.variableDeclarator.init.body.splice(node[pipeIndex][0], 1)
}
