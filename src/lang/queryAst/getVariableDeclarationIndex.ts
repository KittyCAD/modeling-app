import { Program } from 'lang/wasm'

import { Node } from '@rust/kcl-lib/bindings/Node'

/**
 * Given a program and a variable name, return the index of the variable declaration
 * in the body, returning `-1` if it doesn't exist.
 */
export function getVariableDeclarationIndex(
  program: Node<Program>,
  variableName: string
) {
  return program.body.findIndex(
    (item) =>
      item.type === 'VariableDeclaration' &&
      item.declaration.id.name === variableName
  )
}
