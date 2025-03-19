import { getIdentifiersInProgram } from './getIndentifiersInProgram'
import { Program, Expr } from 'lang/wasm'
import { Node } from '@rust/kcl-lib/bindings/Node'
import { getTagDeclaratorsInProgram } from './getTagDeclaratorsInProgram'

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
        a.type === 'VariableDeclaration' && a.declaration.id?.name === curr.name
    )
    return Math.max(acc, bodyIndex + 1)
  }, 0)

  const tagDeclarators = getTagDeclaratorsInProgram(program)
  console.log('FRANK tagDeclarators', {
    identifiers,
    tagDeclarators,
    targetExpr,
  })
  const safeTagIndex = tagDeclarators.reduce((acc, curr) => {
    return identifiers.findIndex((a) => a.name === curr.tag.value) === -1
      ? acc
      : Math.max(acc, curr.bodyIndex + 1)
  }, 0)

  return Math.max(safeIdentifierIndex, safeTagIndex)
}
