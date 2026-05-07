import type { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { WarningLevel } from '@rust/kcl-lib/bindings/WarningLevel'
import { err } from '@src/lib/trap'
import { changeExperimentalFeatures, parse, type Program } from '@src/lang/wasm'
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

function isShowAnnotationsDeclaration(item: BodyItem): boolean {
  return (
    item.type === 'VariableDeclaration' &&
    item.declaration.id.name === 'showAnnotations'
  )
}

function parseShowAnnotationsDeclaration(
  instance: ModuleType
): BodyItem | Error {
  const result = parse('showAnnotations = false\n', instance)
  if (err(result)) {
    return result
  }

  const declaration = result.program?.body[0]
  if (!declaration) {
    return new Error('showAnnotations declaration could not be parsed')
  }

  return declaration
}

export function setShowAnnotations(
  code: string,
  showAnnotations: boolean,
  instance: ModuleType
): Node<Program> | Error {
  const result = parse(code, instance)
  if (err(result)) {
    return result
  }

  if (result.program === null) {
    return new Error('Empty program returned')
  }

  const program = structuredClone(result.program)
  program.body = program.body.filter(
    (item) => !isShowAnnotationsDeclaration(item)
  )

  if (!showAnnotations) {
    const declaration = parseShowAnnotationsDeclaration(instance)
    if (err(declaration)) {
      return declaration
    }
    program.body.unshift(declaration)
  }

  return program
}
