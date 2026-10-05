import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { Program } from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function programTextEqual(
  before: Node<Program>,
  after: Node<Program>,
  wasmInstance: ModuleType
): boolean {
  // Same reference is not proof the program is unchanged: some tag helpers
  // edit the AST they are given and return it.
  const beforeCode = recast(before, wasmInstance)
  const afterCode = recast(after, wasmInstance)
  if (isErr(beforeCode) || isErr(afterCode)) return false
  return beforeCode === afterCode
}
