import { Program } from 'lang/wasm'

import { Node } from '@rust/kcl-lib/bindings/Node'

/**
 * Given a program and a variable name, return the variable declaration
 * if it exists.
 */
export function getVariableDeclaration(
  program: Node<Program>,
  variableName: string
) {
  const foundItem = program.body.find(
    (item) =>
      item.type === 'VariableDeclaration' &&
      item.declaration.id.name === variableName
  )
  if (foundItem?.type === 'VariableDeclaration') {
    return foundItem
  } else {
    return undefined
  }
}
