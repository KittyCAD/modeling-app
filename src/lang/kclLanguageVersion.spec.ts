import { join } from 'node:path'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { isAtLeastKclV3, programUsesKclV3 } from '@src/lang/kclLanguageVersion'
import { parse } from '@src/lang/wasm'
import type { Program } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
let instanceInThisFile: ModuleType | undefined

beforeAll(async () => {
  instanceInThisFile = await loadAndInitialiseWasmInstance(WASM_PATH)
})

const getInstance = (): ModuleType => {
  if (!instanceInThisFile) {
    throw new Error('Expected wasm instance to be initialized')
  }
  return instanceInThisFile
}

const parseProgram = (code: string): Node<Program> => {
  const result = parse(code, getInstance())
  if (err(result)) {
    throw result
  }
  if (!result.program) {
    throw new Error('Expected parse to return a program')
  }
  return result.program
}

describe('isAtLeastKclV3', () => {
  it.each<[KclVersion, boolean]>([
    ['1.0', false],
    ['2.0', false],
    ['3.0-preview', true],
  ])('returns %s -> %s', (version, expected) => {
    expect(isAtLeastKclV3(version)).toBe(expected)
  })

  it('treats missing versions as pre-3.0', () => {
    expect(isAtLeastKclV3(null)).toBe(false)
    expect(isAtLeastKclV3(undefined)).toBe(false)
  })
})

describe('programUsesKclV3', () => {
  it('returns true for a 3.0-preview program', () => {
    const program = parseProgram(`@settings(kclVersion = "3.0-preview")
x = 1`)
    expect(programUsesKclV3(program, getInstance())).toBe(true)
  })

  it('returns false for a 2.0 program', () => {
    const program = parseProgram(`@settings(kclVersion = 2.0)
x = 1`)
    expect(programUsesKclV3(program, getInstance())).toBe(false)
  })

  it('returns false for a program without settings', () => {
    const program = parseProgram(`x = 1`)
    expect(programUsesKclV3(program, getInstance())).toBe(false)
  })

  it('returns false for settings without a kclVersion', () => {
    const program = parseProgram(`@settings(defaultLengthUnit = in)
x = 1`)
    expect(programUsesKclV3(program, getInstance())).toBe(false)
  })
})
