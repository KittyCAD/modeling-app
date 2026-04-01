import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { WarningLevel } from '@rust/kcl-lib/bindings/WarningLevel'
import { err } from '@src/lib/trap'
import {
  changeExperimentalFeatures,
  parse,
  patchSketchBlockMissingDeclarations as pathSketchBlock,
  type Program,
} from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function setExperimentalFeatures(
  code: string,
  level: WarningLevel,
  instance: ModuleType
): Node<Program> | Error {
  const newCode = changeExperimentalFeatures(code, level, instance)
  if (err(newCode)) {
    return newCode
  }

  const result = parse(newCode, instance)
  if (err(result)) {
    return result
  }

  if (result.program === null) {
    return new Error('Empty program returned')
  }

  return result.program
}

export function patchSketchBlockMissingDeclarations(
  code: string,
  instance: ModuleType
):
  | {
      ast: Node<Program>
      changed: boolean
    }
  | Error {
  const newCode = pathSketchBlock(code, instance)
  if (err(newCode)) {
    return newCode
  }

  const result = parse(newCode, instance)
  if (err(result)) {
    return result
  }

  if (result.program === null) {
    return new Error('Empty program returned')
  }

  return {
    ast: result.program,
    changed: newCode !== code,
  }
}
