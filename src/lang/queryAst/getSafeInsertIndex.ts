import type { Node } from '@rust/kcl-lib/bindings/Node'

import { getIdentifiersInProgram } from '@src/lang/queryAst/getIndentifiersInProgram'
import { getTagDeclaratorsInProgram } from '@src/lang/queryAst/getTagDeclaratorsInProgram'
import type { Expr, Program } from '@src/lang/wasm'

/**
 * Given a target expression, return the body index of the last-used variable
 * or tag declaration within the provided program.
 */
export function getSafeInsertIndex(
  targetExpr: Node<Program | Expr>,
  program: Node<Program>
) {
  const identifiers = getIdentifiersInProgram(targetExpr)
  const safeIdentifierIndex = identifiers.reduce((acc, curr) => {
    const bodyIndex = program.body.findIndex(
      (a) =>
        a.type === 'VariableDeclaration' &&
        a.declaration.id?.name === curr.name.name
    )
    return Math.max(acc, bodyIndex + 1)
  }, 0)

  const tagDeclarators = getTagDeclaratorsInProgram(program)
  const safeTagIndex = tagDeclarators.reduce((acc, curr) => {
    return identifiers.findIndex((a) => a.name.name === curr.tag.value) === -1
      ? acc
      : Math.max(acc, curr.bodyIndex + 1)
  }, 0)

  return Math.max(safeIdentifierIndex, safeTagIndex)
}
