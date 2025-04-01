import { getBodyIndex, traverse } from 'lang/queryAst'
import { Expr, Program } from 'lang/wasm'
import { err } from 'lib/trap'

import { Node } from '@rust/kcl-lib/bindings/Node'
import { TagDeclarator } from '@rust/kcl-lib/bindings/TagDeclarator'

type TagWithBodyIndex = { tag: TagDeclarator; bodyIndex: number }

/**
 * Given an AST `Program`, return an array of
 * TagDeclarator nodes within, and the body index of their source expression.
 */
export function getTagDeclaratorsInProgram(
  program: Node<Program | Expr>
): TagWithBodyIndex[] {
  const tagLocations: TagWithBodyIndex[] = []
  traverse(program, {
    enter(node, pathToNode) {
      if (node.type === 'TagDeclarator') {
        // Get the body index of the declarator's farthest ancestor
        const bodyIndex = getBodyIndex(pathToNode)
        if (err(bodyIndex)) return
        tagLocations.push({ tag: node, bodyIndex })
      }
    },
  })
  return tagLocations
}
