import { getIdentifiersInProgram } from './getIndentifiersInProgram'
import { Program, Expr } from 'lang/wasm'
import { Node } from '@rust/kcl-lib/bindings/Node'

/**
 * Given a target expression, return the body index of the last-used variable
 * within the provided program.
 */
export function getSafeInsertIndex(
  targetExpr: Node<Program | Expr>,
  program: Node<Program>
) {
  const identifiers = getIdentifiersInProgram(targetExpr)
  const insertIndex = identifiers.reduce((acc, curr) => {
    const bodyIndex = program.body.findIndex(
      (a) =>
        a.type === 'VariableDeclaration' && a.declaration.id?.name === curr.name
    )
    return Math.max(acc, bodyIndex + 1)
  }, 0)
  return insertIndex
}
