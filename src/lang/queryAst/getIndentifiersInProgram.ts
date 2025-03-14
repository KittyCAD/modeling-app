import { traverse } from 'lang/queryAst'
import { Expr, Identifier, Program } from 'lang/wasm'
import { Node } from '@rust/kcl-lib/bindings/Node'

/**
 * Given an AST `Program`, return an array of
 * all the `Identifier` nodes within.
 */
export function getIdentifiersInProgram(
  program: Node<Program | Expr>
): Identifier[] {
  const identifiers: Identifier[] = []
  traverse(program, {
    enter(node) {
      if (node.type === 'Identifier') {
        identifiers.push(node)
      }
    },
  })
  return identifiers
}
