import { traverse } from 'lang/queryAst'
import { Expr, Name, Program } from 'lang/wasm'

import { Node } from '@rust/kcl-lib/bindings/Node'

/**
 * Given an AST `Program`, return an array of
 * all the `Identifier` nodes within.
 */
export function getIdentifiersInProgram(program: Node<Program | Expr>): Name[] {
  const identifiers: Name[] = []
  traverse(program, {
    enter(node) {
      if (node.type === 'Name' && node.path.length === 0) {
        identifiers.push(node)
      }
    },
  })
  return identifiers
}
