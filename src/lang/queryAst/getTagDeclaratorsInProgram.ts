import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { TagDeclarator } from '@rust/kcl-lib/bindings/TagDeclarator'

import { getBodyIndex, traverse } from '@src/lang/queryAst'
import type { Expr, Program } from '@src/lang/wasm'
import { err } from '@src/lib/trap'

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
