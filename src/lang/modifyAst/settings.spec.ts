import { recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { join } from 'path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import {
  patchSketchBlockMissingDeclarations,
  setExperimentalFeatures,
} from '@src/lang/modifyAst/wasmWrappers'
import { expect, describe, it } from 'vitest'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('settings.spec.ts', () => {
  describe('Testing setExperimentalFeatures', () => {
    it('should add the annotation and set the flag if not present', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const newAst = setExperimentalFeatures('', { type: 'Allow' }, instance)
      if (err(newAst)) {
        throw newAst
      }

      const newCode = recast(newAst, instance)
      expect(newCode).toBe(`@settings(experimentalFeatures = allow)\n`)
    })

    it('should set the flag if the annotation exists', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `@settings(experimentalFeatures = warn)\n`
      const newAst = setExperimentalFeatures(code, { type: 'Deny' }, instance)
      if (err(newAst)) {
        throw newAst
      }

      const newCode = recast(newAst, instance)
      expect(newCode).toBe(`@settings(experimentalFeatures = deny)\n`)
    })
  })

  describe('Testing patchSketchBlockMissingDeclarations', () => {
    it('should add declarations for bare sketch segment calls', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line(start = [0, 0], end = [1, 0])
}`
      const result = patchSketchBlockMissingDeclarations(code, instance)
      if (err(result)) {
        throw result
      }

      expect(result.changed).toBe(true)
      const newCode = recast(result.ast, instance)
      expect(newCode).toContain('line1 = line(')
    })

    it('should add declarations for both line and circle calls', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line(start = [0, 0], end = [1, 0])
  circle(center = [0, 0], radius = 1)
}`
      const result = patchSketchBlockMissingDeclarations(code, instance)
      if (err(result)) {
        throw result
      }

      expect(result.changed).toBe(true)
      const newCode = recast(result.ast, instance)
      expect(newCode).toContain('line1 = line(')
      expect(newCode).toContain('circle1 = circle(')
    })
  })
})
